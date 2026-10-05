import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import {
  Activity,
  BadgeCheck,
  Bot,
  CircleSlash,
  Cpu,
  Database,
  Hand,
  ListChecks,
  MessageSquareText,
  Plus,
  Radio,
  SearchX,
  ShieldCheck,
  WifiOff,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  agentAvailabilityQueryOptions,
  agentRunQueryOptions,
  agentRunsQueryOptions,
  isWorking,
  useAgentRunStream,
  useCancelAgentRun,
  useConfirmAgentRun,
  useCreateAgentRun,
  useReplyAgentRun,
  type AgentAvailability,
  type AgentRun,
  type AgentRunDetail,
  type AgentTool,
  type StreamState,
} from "../../api/agent";
import { asApiError } from "../../api/client";
import { formatNumber } from "../../lib/format";
import { MiniRing } from "../../kit";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { BarList, KpiStrip, KpiTile } from "../../ui/charts";
import { cn } from "../../ui/cn";
import { EmptyState } from "../../ui/EmptyState";
import { PageHeader } from "../../ui/PageHeader";
import { Panel } from "../../ui/Panel";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Skeleton } from "../../ui/Skeleton";
import { StatusDot } from "../../ui/StatusDot";
import { PanelError } from "../command/PanelError";
import { formatMs, isVerified, tripLine } from "./agentText";
import { Composer } from "./Composer";
import { PlanBoard, type BoardActions } from "./PlanBoard";
import { RunList } from "./RunList";
import { RunStatusBadge } from "./RunStatusBadge";
import { RunTrace, TOOL_ICON, traceCounts, type TraceActions } from "./RunTrace";

const UNAVAILABLE = "Agent unavailable — no model configured";
const WIDE = "(min-width: 80rem)";

function subscribeWide(callback: () => void): () => void {
  const media = window.matchMedia(WIDE);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

/** Three columns from 1280 px; below that the columns stack and a switch picks Conversation or Plan. */
function useWideLayout(): boolean {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => true);
}

const errorText = (error: unknown) => (error ? asApiError(error).message : null);

// --- overview (no plan open) -------------------------------------------------------------------

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: MessageSquareText, title: "Describe the trip", body: "Route, dates, travellers and cabin in plain words. Anything missing is asked for." },
  { icon: Radio, title: "Live search, step by step", body: "Airports, fares from your suppliers, hotels, weather and places. Each step shows as it runs." },
  { icon: ShieldCheck, title: "Every price checked", body: "Prices, flight numbers, dates and codes in the summary are matched against this plan's results." },
  { icon: Hand, title: "You approve the writes", body: "Enquiries and quotes are saved only after you approve them. Nothing is booked or paid for." },
];

const TOOLS: { tool: AgentTool; label: string; approval?: boolean }[] = [
  { tool: "lookup_airport", label: "Airport lookup" },
  { tool: "search_flights", label: "Flight search" },
  { tool: "search_hotels", label: "Hotel search" },
  { tool: "fare_insight", label: "Fare insight" },
  { tool: "price_check", label: "Price check" },
  { tool: "weather_forecast", label: "Weather" },
  { tool: "find_places", label: "Places" },
  { tool: "build_itinerary", label: "Itinerary" },
  { tool: "estimate_budget", label: "Budget" },
  { tool: "find_client", label: "Client lookup" },
  { tool: "create_enquiry", label: "Create enquiry", approval: true },
  { tool: "draft_quote", label: "Draft quote", approval: true },
];

const TOOL_NAME = Object.fromEntries(TOOLS.map(({ tool, label }) => [tool, label])) as Partial<Record<AgentTool, string>>;

/** The four stages of a plan, as numbered kit tiles. */
function HowItWorks({ className }: { className?: string }) {
  return (
    <Panel title="How a plan runs" icon={ListChecks} description="From a plain request to a plan you can quote" className={cn("@container", className)}>
      <ol className="grid gap-2.5 @lg:grid-cols-2">
        {STEPS.map(({ icon: Icon, title, body }, index) => (
          <li key={title} className="flex gap-3 rounded-[14px] border border-line bg-card-2 p-3">
            <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-card-2 text-primary">
              <Icon size={16} strokeWidth={1.75} />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold leading-5 text-ink">
                <span className="tm-num mr-1.5 text-faint">{index + 1}</span>
                {title}
              </span>
              <span className="mt-0.5 block text-xs leading-4 text-dim">{body}</span>
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

/** Every tool the planner may call, the two writes flagged as needing approval. */
function ToolsPanel({ className }: { className?: string }) {
  return (
    <Panel title="Tools it can use" icon={Wrench} description="Each call appears in the trace with its result and timing" className={cn("@container", className)}>
      <ul className="grid grid-cols-1 gap-2 @[17rem]:grid-cols-2 @2xl:grid-cols-3">
        {TOOLS.map(({ tool, label, approval }) => {
          const Icon = TOOL_ICON[tool];
          return (
            <li
              key={tool}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-[12px] border border-line bg-card-2 px-2.5 py-2",
                approval && "@[17rem]:col-span-2 @2xl:col-span-1",
              )}
            >
              <Icon size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-dim" />
              <span className="min-w-0 truncate text-[13px] text-ink">{label}</span>
              {approval && <Badge tone="warn" className="ml-auto">Approval</Badge>}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[middle] ?? null) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

const elapsedMs = (run: AgentRun) =>
  run.started_at && run.finished_at ? Date.parse(run.finished_at) - Date.parse(run.started_at) : null;

function PlannerLine({ availability }: { availability: AgentAvailability | undefined }) {
  if (!availability) return <Skeleton className="h-4 w-40" />;
  if (!availability.available) return <StatusDot status="down" label={UNAVAILABLE} />;
  return availability.demo ? (
    <StatusDot status="ok" label="Demo planner · rule-based, on the same live tools" />
  ) : (
    <StatusDot status="ok" label={`Model ${availability.model ?? availability.provider ?? ""}`} />
  );
}

const SOURCES: [string, string, string][] = [
  ["Flights", "Your connected suppliers", "Live, cached or sandbox, labelled on every option"],
  ["Hotels", "Your hotel supplier", "Totals for the stay, with cancellation terms"],
  ["Fare insight", "Your agency's fare history", "Where a fare sits against the usual range"],
  ["Weather", "Open-Meteo", "Forecast up to 16 days, else typical for the dates · CC BY 4.0"],
  ["Places", "OpenStreetMap", "Sights, food and more near the destination · ODbL"],
];

function StatusCard({ availability, className }: { availability: AgentAvailability | undefined; className?: string }) {
  return (
    <Panel title="Agent status" icon={Bot} description="What runs your plans" className={className}>
        <div className="flex flex-col gap-3 text-[13px] text-ink">
          <PlannerLine availability={availability} />
          <ul className="flex flex-col gap-2 border-t border-line pt-3 text-xs leading-4 text-dim">
            {[
              "Every price comes from this plan's own tool results.",
              "Supplier and place data is read as data, never as instructions.",
              "Enquiries and quotes need your approval first.",
              "It never books or pays. Booking stays with your team.",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2">
                <BadgeCheck size={13} aria-hidden="true" className="mt-px shrink-0 text-ok" />
                {line}
              </li>
            ))}
          </ul>
        </div>
    </Panel>
  );
}

/** The kit's KPI row (`g4 keep-2`): four tiles a row on desktops, two on tablets and phones, at the kit gap. */
const KPI_GRID = "[&>div]:grid-cols-2 [&>div]:gap-4 max-sm:[&>div]:gap-3 min-[1181px]:[&>div]:grid-cols-4";

/** The last 20 plans in figures: how many, how many finished, the share with every price verified, typical time. */
function PlanFigures() {
  const runs = useQuery(agentRunsQueryOptions(20));
  const items = runs.data?.items ?? [];
  const done = items.filter((run) => run.status === "done");
  const verified = done.filter((run) => isVerified(run.grounded, run.result)).length;
  const typical = median(done.map(elapsedMs).filter((ms): ms is number => ms !== null));
  return (
      <KpiStrip label="Plan figures" columns={4} busy={runs.isPending} className={KPI_GRID}>
        <KpiTile label="Plans" value={formatNumber(items.length)} hint="Most recent 20" loading={runs.isPending} />
        <KpiTile label="Completed" value={formatNumber(done.length)} hint={`${formatNumber(items.length - done.length)} other outcomes`} loading={runs.isPending} />
        <KpiTile
          label="Verified"
          value={done.length > 0 ? `${Math.round((verified / done.length) * 100)}%` : "—"}
          hint="Every price checked"
          loading={runs.isPending}
        />
        <KpiTile label="Typical time" value={typical !== null ? formatMs(typical) : "—"} hint="Median to finish" loading={runs.isPending} />
      </KpiStrip>
  );
}

function SourcesPanel({ className }: { className?: string }) {
  return (
    <Panel title="Where the data comes from" icon={Database} description="Shown with every result it supports" className={className}>
        <dl className="flex flex-col divide-y divide-line text-[13px]">
          {SOURCES.map(([label, source, note]) => (
            <div key={label} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 py-2 first:pt-0 last:pb-0">
              <dt className="text-dim">{label}</dt>
              <dd className="min-w-0">
                <span className="block text-ink">{source}</span>
                <span className="block text-xs leading-4 text-faint">{note}</span>
              </dd>
            </div>
          ))}
        </dl>
    </Panel>
  );
}

/**
 * The overview with no plan open, as kit cards on the 12-column grid: the composer and recent plans on the left
 * (span 4), and on the right (span 8) the plan figures, how a plan runs beside the agent's status, then the tools
 * beside the data sources. `notice` (a plan that wasn't found or didn't load) leads the right-hand side.
 */
function Overview({ left, availability, notice }: { left: ReactNode; availability: AgentAvailability | undefined; notice?: ReactNode }) {
  return (
    <div className="grid g-12 items-start">
      <div className="span-4 flex min-w-0 flex-col gap-4">{left}</div>
      <div className="span-8 flex min-w-0 flex-col gap-4">
        {notice}
        <PlanFigures />
        <div className="grid g-12">
          <HowItWorks className="span-7" />
          <StatusCard availability={availability} className="span-5" />
          <ToolsPanel className="span-6" />
          <SourcesPanel className="span-6" />
        </div>
      </div>
    </div>
  );
}

// --- an open plan ------------------------------------------------------------------------------

function StreamNote({ state }: { state: StreamState }) {
  if (state === "paused") {
    return (
      <p role="status" className="callout items-center gap-2 px-3 py-2 text-xs leading-4 text-dim">
        <WifiOff size={13} aria-hidden="true" className="shrink-0 text-faint" />
        Live updates paused, too many open views; refresh later. This plan is checked every few seconds instead.
      </p>
    );
  }
  if (state === "reconnecting") {
    return (
      <p role="status" className="flex items-center gap-2 text-xs text-dim">
        <WifiOff size={13} aria-hidden="true" className="shrink-0 text-warn" />
        Reconnecting to live updates…
      </p>
    );
  }
  return null;
}

function Telemetry({ run }: { run: AgentRunDetail }) {
  const counts = traceCounts(run.steps);
  const elapsed = elapsedMs(run);
  const labels = new Map<string, string>();
  for (const step of run.steps) if (step.kind === "tool_call") labels.set(step.payload.call_id, step.payload.label);
  const bars = run.steps.flatMap((step) =>
    step.kind === "tool_result"
      ? [
          {
            label: TOOL_NAME[step.payload.tool] ?? step.payload.tool.replace(/_/g, " "),
            value: step.duration_ms ?? 0,
            hint: [labels.get(step.payload.call_id), step.payload.ok ? null : "failed"].filter(Boolean).join(" · ") || undefined,
          },
        ]
      : [],
  );
  const succeeded = counts.tools - counts.failures;
  return (
    <Panel
      title="Run telemetry"
      icon={Activity}
      className="@container"
      description={run.demo ? "Demo planner · rule-based" : `Model ${run.model}`}
      actions={
        counts.tools > 0 ? (
          <div role="img" aria-label={`${succeeded} of ${counts.tools} tool calls succeeded`} className="flex items-center gap-2">
            <MiniRing
              value={succeeded}
              max={counts.tools}
              size={44}
              color={counts.failures > 0 ? "var(--tm-warn)" : "var(--tm-ok)"}
              label={`${succeeded}/${counts.tools}`}
            />
          </div>
        ) : undefined
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 @sm:grid-cols-4">
        {[
          ["Steps", formatNumber(counts.steps)],
          ["Tools", formatNumber(counts.tools)],
          ["Elapsed", elapsed !== null ? formatMs(elapsed) : isWorking(run.status) ? "Running" : "—"],
          ["Tokens", formatNumber(run.input_tokens + run.output_tokens)],
        ].map(([label, value]) => (
          <div key={label} className="stat flex min-w-0 flex-col gap-1">
            <dt className="hud">{label}</dt>
            <dd className="v truncate text-[22px]!">{value}</dd>
          </div>
        ))}
      </dl>
      {bars.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="hud mb-2.5">Time per tool call</p>
          {/* Relative and clipped: the chart's screen-reader table is wider than a phone column. */}
          <div className="relative overflow-hidden">
            <BarList label="Time per tool call" items={bars} valueFormat={formatMs} />
          </div>
        </div>
      )}
      {run.prompt_version && <p className="mt-3 text-[11px] leading-4 text-faint">Instructions version {run.prompt_version}</p>}
    </Panel>
  );
}

type Layout = {
  left: ReactNode;
  centre: ReactNode;
  right: ReactNode;
  hasRun: boolean;
  /** The question or approval the run waits on (its call id): a phone showing the plan switches back to it. */
  attention?: string | null;
};

const PANE = "flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]";
/** The three panes on the kit's 12-column grid (3 · 4 · 5), one row as tall as the rest of the window. */
const WIDE_GRID = "grid g-12 min-h-[35rem] flex-1 grid-rows-[minmax(0,1fr)]";

/**
 * Wide: three panes that fill the rest of the window (the page is a full-height column) and scroll on their
 * own, so the long plan board never leaves the others empty. Narrow: stacked, with a Conversation / Plan
 * switch that returns to the conversation when a new question or approval arrives.
 */
function Columns({ left, centre, right, hasRun, attention = null }: Layout) {
  const wide = useWideLayout();
  const [view, setView] = useState<"conversation" | "plan">("conversation");
  const [seen, setSeen] = useState<string | null>(attention);
  // Adjusted while rendering (not in an effect): a new request for input brings the conversation forward.
  if (attention !== seen) {
    setSeen(attention);
    if (attention) setView("conversation");
  }
  if (wide) {
    return (
      <div className={WIDE_GRID}>
        <div data-pane="requests" className={cn("span-3", PANE)}>{left}</div>
        <div data-pane="conversation" className={cn("span-4", PANE)}>{centre}</div>
        <div data-pane="plan" className={cn("span-5", PANE)}>{right}</div>
      </div>
    );
  }
  if (!hasRun) {
    return (
      <div className="flex flex-col gap-4">
        {left}
        {centre}
        {right}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl
        label="Show"
        value={view}
        onChange={setView}
        options={[
          { value: "conversation", label: "Conversation" },
          { value: "plan", label: "Plan" },
        ]}
        className="self-start"
      />
      {view === "conversation" ? (
        <>
          {centre}
          {left}
        </>
      ) : (
        right
      )}
    </div>
  );
}

function OpenRun({
  run,
  stream,
  left,
  onRestart,
  restarting,
  onExtend,
  unavailable,
}: {
  run: AgentRunDetail;
  stream: StreamState;
  left: ReactNode;
  onRestart: (prompt: string) => void;
  restarting: boolean;
  onExtend: (prompt: string) => void;
  unavailable: boolean;
}) {
  const reply = useReplyAgentRun();
  const confirm = useConfirmAgentRun();
  const cancel = useCancelAgentRun();
  const [asking, setAsking] = useState<"enquiry" | "quote" | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const create = useCreateAgentRun();
  const navigate = useNavigate();
  const working = isWorking(run.status);
  const cancellable = working || run.status === "waiting_for_user";
  const pendingId = run.status === "waiting_for_user" ? (run.pending?.call_id ?? null) : null;
  const logRef = useRef<HTMLDivElement>(null);
  // Answers being typed, by question: held here so a layout change (phone ↔ desktop) keeps them.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const trace: TraceActions = {
    onReply: (text) =>
      reply.mutate(
        { runId: run.id, text, callId: pendingId ?? undefined },
        {
          onSuccess: () => {
            if (pendingId) setDrafts((all) => ({ ...all, [pendingId]: "" }));
            logRef.current?.focus();
          },
        },
      ),
    replying: reply.isPending,
    // Errors belong to the question or approval they were sent for; a new one starts clean.
    replyError: reply.variables?.callId === pendingId ? errorText(reply.error) : null,
    answerDraft: pendingId ? (drafts[pendingId] ?? "") : "",
    onAnswerDraft: (text) => {
      if (pendingId) setDrafts((all) => ({ ...all, [pendingId]: text }));
    },
    onDecide: (approve) => confirm.mutate({ runId: run.id, callId: pendingId ?? "", approve }),
    deciding: confirm.isPending ? (confirm.variables?.approve ? "approve" : "decline") : null,
    decideError: confirm.variables?.callId === pendingId ? errorText(confirm.error) : null,
  };

  // A finished plan can't take a reply, so these start a new plan that asks for the write about this trip;
  // that plan then waits for approval before anything is saved.
  const board: BoardActions = {
    onAsk: (action) => {
      const request = action === "enquiry" ? "Create an enquiry for this trip" : "Draft a quote for this trip";
      const trip = run.result?.trip;
      const prompt = trip ? `${request}: ${tripLine(trip)}.` : `${request}. ${run.prompt}`;
      setAskError(null);
      setAsking(action);
      create.mutate(prompt, {
        onSettled: () => setAsking(null),
        onError: (error) => setAskError(errorText(error)),
        onSuccess: (created) => void navigate({ to: "/app/agent/$runId", params: { runId: created.run_id } }),
      });
    },
    asking,
    askError,
    onExtend,
    blockedReason: unavailable ? "New plans can't start until a model is configured." : null,
  };

  const conversation = (
    <Panel
      title="Conversation"
      icon={MessageSquareText}
      description={run.demo ? "Demo planner · each step as it runs" : "Each step as it runs"}
      actions={
        <>
          <RunStatusBadge status={run.status} />
          {cancellable && (
            <Button variant="secondary" size="sm" onClick={() => cancel.mutate(run.id)} loading={cancel.isPending}>
              <CircleSlash size={14} aria-hidden="true" />
              Cancel
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <StreamNote state={stream} />
        {cancel.isError && (
          <p role="alert" className="text-xs text-danger">
            {errorText(cancel.error)}
          </p>
        )}
        <RunTrace run={run} actions={trace} onRetry={() => onRestart(run.prompt)} retrying={restarting} logRef={logRef} />
      </div>
    </Panel>
  );

  return (
    <Columns
      hasRun
      attention={pendingId}
      left={left}
      centre={
        <>
          {conversation}
          <Telemetry run={run} />
        </>
      }
      right={<PlanBoard run={run} actions={board} />}
    />
  );
}

/** One plan: loads it, follows it live while it runs, and lays it out. */
function RunWorkspace({
  runId,
  left,
  availability,
  onRestart,
  restarting,
  onExtend,
}: {
  runId: string;
  left: ReactNode;
  availability: AgentAvailability | undefined;
  onRestart: (prompt: string) => void;
  restarting: boolean;
  onExtend: (prompt: string) => void;
}) {
  const run = useQuery(agentRunQueryOptions(runId));
  const stream = useAgentRunStream(runId);
  if (run.isPending) {
    return (
      <Columns
        hasRun
        left={left}
        centre={<LoadingRun />}
        right={
          <Panel title="Plan" icon={ListChecks} busy>
            <Skeleton lines={8} />
          </Panel>
        }
      />
    );
  }
  if (run.isError) {
    const error = asApiError(run.error);
    return (
      <Overview
        left={left}
        availability={availability}
        notice={
          error.status === 404 ? (
            <div className="card p-0">
              <EmptyState
                icon={SearchX}
                title="Plan not found"
                description="It may be from another workspace, or the link is incomplete."
                action={{ label: "Start a new plan", to: "/app/agent" }}
              />
            </div>
          ) : (
            <PanelError error={run.error} onRetry={() => void run.refetch()} retrying={run.isFetching} />
          )
        }
      />
    );
  }
  return (
    <OpenRun
      run={run.data}
      stream={stream}
      left={left}
      onRestart={onRestart}
      restarting={restarting}
      onExtend={onExtend}
      unavailable={availability?.available === false}
    />
  );
}

function LoadingRun() {
  return (
    <Panel title="Conversation" icon={MessageSquareText} busy>
      <Skeleton lines={6} />
      <span className="sr-only">Loading plan…</span>
    </Panel>
  );
}

/**
 * The Agent workspace: the request composer and recent plans, the conversation with its live trace, and the
 * plan board. /app/agent/$runId opens one plan and follows it live until it ends.
 */
export function AgentPage() {
  const { runId } = useParams({ strict: false }) as { runId?: string };
  const raw = useSearch({ strict: false }) as { prompt?: unknown };
  const search = { prompt: typeof raw.prompt === "string" ? raw.prompt : undefined };
  const navigate = useNavigate();
  const availability = useQuery(agentAvailabilityQueryOptions);
  const create = useCreateAgentRun();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(search.prompt ?? "");
  const [seenPrompt, setSeenPrompt] = useState(search.prompt);
  // A new prefill (e.g. "Plan with agent" from an enquiry while this page is open) replaces the draft.
  if (search.prompt !== seenPrompt) {
    setSeenPrompt(search.prompt);
    if (search.prompt) setDraft(search.prompt);
  }

  const unavailable = availability.data?.available === false;
  const start = useCallback(
    (prompt: string) => {
      create.mutate(prompt, {
        onSuccess: (created) => {
          setDraft("");
          void navigate({ to: "/app/agent/$runId", params: { runId: created.run_id } });
        },
      });
    },
    [create, navigate],
  );
  const extend = useCallback((prompt: string) => {
    setDraft(prompt);
    inputRef.current?.focus();
  }, []);

  const left = (
    <>
      <Composer
        value={draft}
        onChange={setDraft}
        onSubmit={start}
        submitting={create.isPending}
        error={errorText(create.error)}
        disabledReason={unavailable ? "Plans can't start until a model is configured. Past plans stay readable." : null}
        inputRef={inputRef}
      />
      <RunList activeId={runId} />
    </>
  );

  return (
    <div className="flex flex-col xl:h-full">
      <PageHeader
        breadcrumb={[{ label: "Workspace", to: "/app" }, { label: "Agent" }]}
        title="Agent"
        description="Plans trips from a plain request with live fares, hotels and weather. Every price is checked against the results."
        meta={
          availability.data?.demo ? (
            <Badge tone="info">
              <Cpu size={11} aria-hidden="true" />
              Demo planner
            </Badge>
          ) : undefined
        }
        actions={
          runId ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void navigate({ to: "/app/agent" });
                window.setTimeout(() => inputRef.current?.focus(), 0);
              }}
            >
              <Plus size={14} aria-hidden="true" />
              New plan
            </Button>
          ) : undefined
        }
      />
      {unavailable && (
        <div role="status" className="card warn mb-4 flex items-start gap-3 px-4 py-3">
          <WifiOff size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-warn" />
          <div>
            <p className="text-sm font-semibold text-ink">{UNAVAILABLE}</p>
            <p className="mt-0.5 text-[13px] leading-5 text-dim">
              An administrator needs to add a model key before new plans can run. Past plans stay readable.
            </p>
          </div>
        </div>
      )}
      {runId ? (
        <RunWorkspace
          key={runId}
          runId={runId}
          left={left}
          availability={availability.data}
          onRestart={start}
          restarting={create.isPending}
          onExtend={extend}
        />
      ) : (
        <Overview left={left} availability={availability.data} />
      )}
    </div>
  );
}
