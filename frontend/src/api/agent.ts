import {
  mutationOptions,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ApiError, apiFetch } from "./client";
import type { Cabin, Provenance } from "./offers";
import { segment } from "./workspaceCache";

/**
 * The agent API (/api/v1/agent), field for field with backend/src/travelmind/agent/schemas.py (runs, steps,
 * availability) and the tool result shapes the steps and plans carry (agent/tools, agent/plan.py).
 */

export type AgentRunStatus =
  | "queued"
  | "running"
  | "waiting_for_user"
  | "done"
  | "failed"
  | "cancelled"
  | "budget_exceeded";

/** A run in one of these never changes again; its event stream closes. */
export const TERMINAL_STATUSES: readonly AgentRunStatus[] = ["done", "failed", "cancelled", "budget_exceeded"];
export const isTerminal = (status: AgentRunStatus): boolean => TERMINAL_STATUSES.includes(status);
/** Work is under way (the Cancel button shows). */
export const isWorking = (status: AgentRunStatus): boolean => status === "queued" || status === "running";

/** Prompts and replies: 1–2000 characters after trimming (MAX_TEXT_CHARS). */
export const MAX_AGENT_TEXT = 2000;

export type AgentTool =
  | "lookup_airport"
  | "search_flights"
  | "search_hotels"
  | "price_check"
  | "fare_insight"
  | "weather_forecast"
  | "find_places"
  | "build_itinerary"
  | "estimate_budget"
  | "ask_user"
  | "find_client"
  | "create_enquiry"
  | "draft_quote";

export type WriteTool = "create_enquiry" | "draft_quote";

// --- tool result shapes (agent/tools) ------------------------------------------------------

export type AgentSlice = {
  origin: string;
  destination: string;
  /** Airport-local "YYYY-MM-DDTHH:MM". */
  departs_at: string;
  departs_display: string;
  arrives_at: string;
  arrives_display: string;
  stops: number;
  duration_minutes: number | null;
  flight_numbers: string[];
};

/** A flight offer as the tools show it: the run's own id (F1), never the supplier's. */
export type AgentFlightCard = {
  offer_id: string;
  carrier: string;
  carrier_name: string | null;
  flight_numbers: string[];
  slices: AgentSlice[];
  stops: number;
  duration_minutes: number | null;
  cabin: Cabin | null;
  total_minor: number;
  total_currency: string;
  /** "≈ ₹8,331" when converted from the supplier's currency. */
  total_formatted: string;
  converted: boolean;
  /** The exchange rates' date, set only when converted. */
  fx_as_of: string | null;
  supplier_total_minor: number;
  supplier_total_currency: string;
  supplier_total_formatted: string;
  per_traveller_minor: number;
  per_traveller_formatted: string;
  provenance: Provenance;
  fare_insight: "good" | "typical" | "high" | null;
  fare_insight_note: string | null;
  co2_kg_per_passenger: number | null;
  refundable: boolean | null;
  checked_bags: number | null;
};

export type AgentHotelCard = {
  hotel_id: string;
  name: string;
  stars: number | null;
  rating: number | null;
  area: string | null;
  room: string | null;
  board: string | null;
  refundable: boolean | null;
  free_cancellation_until: string | null;
  total_minor: number;
  total_currency: string;
  total_formatted: string;
  converted: boolean;
  fx_as_of: string | null;
  supplier_total_minor: number;
  supplier_total_currency: string;
  supplier_total_formatted: string;
  per_night_minor: number;
  per_night_formatted: string;
  nights: number;
  provenance: Provenance;
};

export type AgentPlaceCard = {
  place_id: string;
  name: string;
  kind: string;
  latitude: number;
  longitude: number;
  distance_km: number | null;
  notable?: boolean;
  rate?: number;
  source: "openstreetmap" | "opentripmap";
};

/** search_flights' trip block, or search_hotels' when no flights were searched. */
export type AgentTrip = {
  origin?: string;
  origin_city?: string | null;
  destination: string;
  destination_city?: string | null;
  depart_date?: string;
  depart_date_display?: string;
  return_date?: string | null;
  return_date_display?: string | null;
  adults: number;
  children_ages?: number[];
  cabin?: Cabin;
  check_in?: string;
  check_in_display?: string;
  check_out?: string;
  check_out_display?: string;
  nights?: number;
  rooms?: number;
};

export type AgentWeatherDay = {
  date: string;
  date_display: string;
  temp_max_c: number | null;
  temp_min_c: number | null;
  precipitation_mm: number | null;
  precipitation_chance_pct: number | null;
  conditions: string | null;
};

export type AgentWeather = {
  place: { name: string; code: string | null; latitude: number; longitude: number };
  label: "forecast" | "typical";
  note: string | null;
  units: { temperature: string; precipitation: string };
  days: AgentWeatherDay[];
  attribution: string;
};

export type AgentItineraryItem = { id: string; kind: "flight" | "hotel" | "place"; label: string };
export type AgentItineraryDay = {
  day: number;
  date: string | null;
  date_display: string | null;
  title: string | null;
  items: AgentItineraryItem[];
  notes: string | null;
};

export type AgentBudgetTotal = { currency: string; total_minor: number; total_formatted: string; converted: boolean };
export type AgentBudgetCategory = AgentBudgetTotal & { category: "flights" | "hotels"; items: string[] };
export type AgentBudget = {
  currency: string | null;
  total_minor: number | null;
  total_formatted: string | null;
  converted: boolean;
  categories: AgentBudgetCategory[];
  totals_by_currency: AgentBudgetTotal[];
  unpriced: string[];
  note: string | null;
};

/** The run's result (agent/plan.py PlanResult): every card and figure comes from this run's tools. */
export type PlanResult = {
  summary: string;
  trip: AgentTrip | null;
  flights: AgentFlightCard[];
  hotels: AgentHotelCard[];
  places: AgentPlaceCard[];
  itinerary: AgentItineraryDay[];
  budget: AgentBudget | null;
  weather: AgentWeather | null;
  next_steps: string[];
  fallback: boolean;
};

// --- runs and steps ------------------------------------------------------------------------

export type PendingQuestion = { kind: "question"; call_id: string; question: string; fields: string[] };
export type PendingConfirm = {
  kind: "confirm";
  call_id: string;
  tool: WriteTool;
  /** "Create an enquiry DEL → BOM, 3 Nov 2026 to 6 Nov 2026, for 2 adults." */
  action: string;
  args: Record<string, unknown>;
  /** Cautions to read before approving (e.g. a client matched by name only). Absent from older servers. */
  warnings?: string[];
};
export type Pending = PendingQuestion | PendingConfirm;

export type AgentRun = {
  id: string;
  kind: "agency" | "traveller";
  status: AgentRunStatus;
  prompt: string;
  provider: string;
  model: string;
  /** The rule-based demo planner, not a model. */
  demo: boolean;
  prompt_version: string | null;
  grounded: boolean | null;
  error: string | null;
  result: PlanResult | null;
  /** Set only while waiting_for_user. */
  pending: Pending | null;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

type StepBase = { seq: number; duration_ms: number | null; created_at: string };

export type ThinkingStep = StepBase & { kind: "thinking"; payload: { text: string | null; unverified: boolean } };
export type ToolCallStep = StepBase & {
  kind: "tool_call";
  payload: { call_id: string; tool: AgentTool; args: Record<string, unknown>; label: string };
};
export type ToolResultStep = StepBase & {
  kind: "tool_result";
  payload: { call_id: string; tool: AgentTool; ok: boolean; summary: string; data: Record<string, unknown>; memo: boolean };
};
export type AskUserStep = StepBase & { kind: "ask_user"; payload: Pending };
export type UserStep = StepBase & {
  kind: "user";
  payload: { text: string; call_id: string | null } | { call_id: string; decision: "approved" | "declined"; action: string | null };
};
export type GuardViolation = { kind: "money" | "flight" | "date" | "code"; text: string };
export type GuardStep = StepBase & {
  kind: "guard";
  payload: { passed: boolean; action: "passed" | "reprompt" | "fallback"; violations: GuardViolation[] };
};
export type AnswerStep = StepBase & { kind: "answer"; payload: { text: string; grounded: boolean; fallback: boolean } };
export type ErrorStep = StepBase & { kind: "error"; payload: { code: string; message: string } };

export type AgentStep =
  | ThinkingStep
  | ToolCallStep
  | ToolResultStep
  | AskUserStep
  | UserStep
  | GuardStep
  | AnswerStep
  | ErrorStep;

export type AgentRunDetail = AgentRun & { steps: AgentStep[] };
export type AgentRunList = { items: AgentRun[] };
export type AgentRunCreated = { run_id: string; status: AgentRunStatus };
export type AgentAvailability = {
  available: boolean;
  provider: "gemini" | "fake" | null;
  model: string | null;
  demo: boolean;
};

const BASE = "/api/v1/agent";

export const agentApi = {
  availability: (signal?: AbortSignal) => apiFetch<AgentAvailability>(`${BASE}/availability`, { signal }),
  list: (limit = 20, signal?: AbortSignal) => apiFetch<AgentRunList>(`${BASE}/runs?limit=${limit}`, { signal }),
  get: (id: string, signal?: AbortSignal) => apiFetch<AgentRunDetail>(`${BASE}/runs/${segment(id)}`, { signal }),
  create: (prompt: string) => apiFetch<AgentRunCreated>(`${BASE}/runs`, { method: "POST", body: { prompt } }),
  reply: (id: string, text: string) =>
    apiFetch<AgentRun>(`${BASE}/runs/${segment(id)}/reply`, { method: "POST", body: { text } }),
  confirm: (id: string, callId: string, approve: boolean) =>
    apiFetch<AgentRun>(`${BASE}/runs/${segment(id)}/confirm`, { method: "POST", body: { call_id: callId, approve } }),
  cancel: (id: string) => apiFetch<AgentRun>(`${BASE}/runs/${segment(id)}/cancel`, { method: "POST" }),
  eventsUrl: (id: string, lastSeq: number) => `${BASE}/runs/${segment(id)}/events?last_event_id=${lastSeq}`,
};

/** Every key starts with "agent"; all of them belong to the session. */
export const agentKeys = {
  all: ["agent"] as const,
  availability: ["agent", "availability"] as const,
  lists: ["agent", "runs"] as const,
  list: (limit: number) => ["agent", "runs", limit] as const,
  run: (id: string) => ["agent", "run", id] as const,
};

export const agentAvailabilityQueryOptions = queryOptions({
  queryKey: agentKeys.availability,
  queryFn: ({ signal }) => agentApi.availability(signal),
  staleTime: 60_000,
});

export function agentRunsQueryOptions(limit = 20) {
  return queryOptions({
    queryKey: agentKeys.list(limit),
    queryFn: ({ signal }) => agentApi.list(limit, signal),
    staleTime: 15_000,
  });
}

/** The live stream keeps an open run current, so the detail never refetches on focus. */
export function agentRunQueryOptions(id: string) {
  return queryOptions({
    queryKey: agentKeys.run(id),
    // A refetch keeps any step the stream delivered meanwhile (merged by seq, the server's copy winning).
    queryFn: async ({ signal, client }) => {
      const fresh = await agentApi.get(id, signal);
      const held = client.getQueryData<AgentRunDetail>(agentKeys.run(id));
      return held ? { ...fresh, steps: mergeSteps(held.steps, fresh.steps) } : fresh;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

// --- cache updates -------------------------------------------------------------------------

/** Steps by seq, each once, in order: a replayed or repeated step never shows twice. */
export function mergeSteps(current: readonly AgentStep[], incoming: readonly AgentStep[]): AgentStep[] {
  const bySeq = new Map<number, AgentStep>();
  for (const step of current) bySeq.set(step.seq, step);
  for (const step of incoming) bySeq.set(step.seq, step);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

export function lastSeq(steps: readonly AgentStep[] | undefined): number {
  return (steps ?? []).reduce((max, step) => Math.max(max, step.seq), -1);
}

/** A run's new state (a status event or a mutation's answer) over its cached detail, steps kept. */
export function applyRun(client: QueryClient, run: AgentRun): void {
  client.setQueryData<AgentRunDetail>(agentKeys.run(run.id), (old) => ({ ...run, steps: old?.steps ?? [] }));
  client.setQueriesData<AgentRunList>({ queryKey: agentKeys.lists }, (old) =>
    old ? { items: old.items.map((item) => (item.id === run.id ? { ...run } : item)) } : old,
  );
}

export function applySteps(client: QueryClient, runId: string, steps: readonly AgentStep[]): void {
  client.setQueryData<AgentRunDetail>(agentKeys.run(runId), (old) => (old ? { ...old, steps: mergeSteps(old.steps, steps) } : old));
}

function refreshList(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: agentKeys.lists });
}

export function createAgentRunMutation(client: QueryClient) {
  return mutationOptions({
    mutationFn: (prompt: string) => agentApi.create(prompt),
    onSuccess: () => refreshList(client),
  });
}

export function replyAgentRunMutation(client: QueryClient) {
  return mutationOptions({
    // `callId` names the question answered, so an error shows only against that question; it isn't sent.
    mutationFn: ({ runId, text }: { runId: string; text: string; callId?: string }) => agentApi.reply(runId, text),
    onSuccess: (run) => applyRun(client, run),
  });
}

export function confirmAgentRunMutation(client: QueryClient) {
  return mutationOptions({
    mutationFn: ({ runId, callId, approve }: { runId: string; callId: string; approve: boolean }) =>
      agentApi.confirm(runId, callId, approve),
    onSuccess: (run) => applyRun(client, run),
  });
}

export function cancelAgentRunMutation(client: QueryClient) {
  return mutationOptions({
    mutationFn: (runId: string) => agentApi.cancel(runId),
    onSuccess: (run) => {
      applyRun(client, run);
      refreshList(client);
    },
  });
}

export const useCreateAgentRun = () => useMutation(createAgentRunMutation(useQueryClient()));
export const useReplyAgentRun = () => useMutation(replyAgentRunMutation(useQueryClient()));
export const useConfirmAgentRun = () => useMutation(confirmAgentRunMutation(useQueryClient()));
export const useCancelAgentRun = () => useMutation(cancelAgentRunMutation(useQueryClient()));

// --- live stream ---------------------------------------------------------------------------

/**
 * `paused`: no live stream (the server refused another one with 429, it kept failing, or the browser has no
 * EventSource), so the run is re-read every few seconds instead. `stopped`: the session ended (401); the
 * app's sign-in handling takes over and nothing is retried.
 */
export type StreamState = "idle" | "connecting" | "open" | "reconnecting" | "paused" | "stopped" | "closed";

/**
 * Stream timing. Reconnect delays grow 1 s, 2 s, 4 s, 8 s, then stay at 15 s, and reset once the stream
 * delivers. A connection that fails `maxNeverOpened` times in a row without ever opening gives up on live
 * updates and polls instead. Exported (and writable) so tests can shorten it.
 */
export const streamTiming = {
  backoffMs: [1_000, 2_000, 4_000, 8_000, 15_000] as readonly number[],
  maxNeverOpened: 3,
  /** Re-read a paused run this often while it works… */
  pollMs: 3_000,
  /** …and this often while it waits on someone. */
  waitingPollMs: 15_000,
};

/** The delay before reconnect number `attempt` (0-based). */
export function streamBackoff(attempt: number): number {
  const steps = streamTiming.backoffMs;
  return steps[Math.min(Math.max(attempt, 0), steps.length - 1)] ?? 15_000;
}

/** How often a paused run is re-read, or false once it is final (or can't be read any more). */
export function pollInterval(run: AgentRun | undefined, errorStatus: number | null): number | false {
  if (!run || isTerminal(run.status)) return false;
  if (errorStatus === 401 || errorStatus === 403 || errorStatus === 404) return false;
  return run.status === "waiting_for_user" ? streamTiming.waitingPollMs : streamTiming.pollMs;
}

/**
 * EventSource can't see why a connection failed, so the first connection that fails without opening is
 * asked about once with fetch: its status only (the request is aborted as soon as the headers arrive, and
 * with `signal` when the hook cleans up). Null when there is no answer.
 */
async function probeStatus(url: string, signal: AbortSignal): Promise<number | null> {
  const probe = new AbortController();
  const abort = () => probe.abort();
  signal.addEventListener("abort", abort);
  try {
    const response = await fetch(url, { credentials: "include", signal: probe.signal, headers: { Accept: "text/event-stream" } });
    return response.status;
  } catch {
    return null;
  } finally {
    probe.abort();
    signal.removeEventListener("abort", abort);
  }
}

function parse<T>(event: MessageEvent): T | null {
  try {
    return JSON.parse(String(event.data)) as T;
  } catch {
    return null;
  }
}

type Mode = { runId: string; mode: "poll" | "stopped" };
type Live = { runId: string; state: StreamState };

/**
 * Follows an open run over Server-Sent Events once its detail is loaded: each `step` is merged into the
 * run's cache by seq (a replay never duplicates), each `status` replaces the run's state, and a final status
 * closes the stream. A dropped connection is reopened after a growing backoff from the last seq held
 * (`?last_event_id=`), so nothing is missed. A server refusing more streams (429), repeated failures to
 * connect, or a browser without EventSource switch to polling the run; an ended session (401) stops and
 * leaves it to the app's sign-in handling. Everything is closed and aborted on unmount or a new run.
 *
 * State only changes from event callbacks, never synchronously in the effect: "connecting" is derived (no
 * report yet for this run), so a new run never shows the previous run's state.
 */
export function useAgentRunStream(runId: string | undefined): StreamState {
  const client = useQueryClient();
  const supported = typeof EventSource !== "undefined";
  const [mode, setMode] = useState<Mode | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  // Probe at most once for this hook's lifetime.
  const probed = useRef(false);
  const current = runId && mode?.runId === runId ? mode.mode : null;
  const polling = Boolean(runId) && (current === "poll" || !supported);
  const run = useQuery({
    ...agentRunQueryOptions(runId ?? ""),
    enabled: Boolean(runId),
    refetchInterval: (query) =>
      polling ? pollInterval(query.state.data, query.state.error instanceof ApiError ? query.state.error.status : null) : false,
  });
  const loaded = run.data !== undefined;
  const status = run.data?.status;
  const open = loaded && !isTerminal(run.data.status);

  // While polling, a status change still refreshes the run list (the stream would have).
  useEffect(() => {
    if (polling && status) refreshList(client);
  }, [client, polling, status]);

  useEffect(() => {
    if (!runId || !open || polling || current === "stopped") return;
    const controller = new AbortController();
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let neverOpened = 0;
    let stopped = false;

    const cached = () => client.getQueryData<AgentRunDetail>(agentKeys.run(runId));
    const report = (state: StreamState) => setLive({ runId, state });
    const halt = () => {
      stopped = true;
      source?.close();
      source = null;
      if (timer !== null) clearTimeout(timer);
    };
    const giveUp = (next: Mode["mode"]) => {
      halt();
      setMode({ runId, mode: next });
    };

    const connect = () => {
      if (stopped) return;
      const es = new EventSource(agentApi.eventsUrl(runId, lastSeq(cached()?.steps)), { withCredentials: true });
      source = es;
      let opened = false;
      const delivered = () => {
        opened = true;
        attempt = 0;
        neverOpened = 0;
        report("open");
      };
      es.onopen = () => {
        if (source === es) delivered();
      };
      es.addEventListener("step", (event) => {
        if (source !== es) return;
        const step = parse<AgentStep>(event as MessageEvent);
        if (!step || typeof step.seq !== "number") return;
        delivered();
        if (step.seq > lastSeq(cached()?.steps)) applySteps(client, runId, [step]);
      });
      es.addEventListener("status", (event) => {
        if (source !== es) return;
        const next = parse<AgentRun>(event as MessageEvent);
        if (!next || next.id !== runId) return;
        delivered();
        const before = cached()?.status;
        applyRun(client, next);
        if (before !== next.status) refreshList(client);
        if (isTerminal(next.status)) halt();
      });
      es.onerror = () => {
        if (source !== es || stopped) return;
        es.close();
        source = null;
        const delay = streamBackoff(attempt);
        attempt += 1;
        report("reconnecting");
        const retry = () => {
          if (!stopped) timer = setTimeout(connect, delay);
        };
        if (opened) {
          retry();
          return;
        }
        neverOpened += 1;
        if (neverOpened >= streamTiming.maxNeverOpened) {
          giveUp("poll");
          return;
        }
        if (probed.current) {
          retry();
          return;
        }
        probed.current = true;
        void probeStatus(agentApi.eventsUrl(runId, lastSeq(cached()?.steps)), controller.signal).then((code) => {
          if (stopped) return;
          if (code === 429) {
            giveUp("poll");
          } else if (code === 401) {
            // The session is gone: re-reading the run lets the app's sign-in handling take over.
            giveUp("stopped");
            void client.refetchQueries({ queryKey: agentKeys.run(runId) });
          } else {
            retry();
          }
        });
      };
    };

    connect();
    return () => {
      halt();
      controller.abort();
    };
  }, [client, runId, open, polling, current]);

  if (!runId) return "idle";
  if (polling) return open ? "paused" : "closed";
  if (current === "stopped") return "stopped";
  if (!open) return loaded ? "closed" : "idle";
  return live?.runId === runId ? live.state : "connecting";
}
