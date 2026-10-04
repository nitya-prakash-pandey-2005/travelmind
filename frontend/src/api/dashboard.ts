import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { ClientCreate, ClientList, ClientOut as Client } from "./clients";
import type { EnquiryCreate, EnquiryList, EnquiryOut as Enquiry } from "./enquiries";

/** Command Center responses, field for field with the backend's dashboard, enquiry and client schemas. */

export type DashboardRange = "7d" | "30d" | "90d";
export const DASHBOARD_RANGES: readonly DashboardRange[] = ["7d", "30d", "90d"];
export const DEFAULT_RANGE: DashboardRange = "30d";

export function isDashboardRange(value: unknown): value is DashboardRange {
  return typeof value === "string" && (DASHBOARD_RANGES as readonly string[]).includes(value);
}

export type KpiKey =
  | "open_enquiries"
  | "quotes_sent"
  | "win_rate"
  | "pipeline_value"
  | "response_time"
  | "co2_quoted"
  | "searches";
export type KpiUnit = "count" | "percent" | "money" | "minutes" | "kg";

export type Kpi = {
  key: KpiKey;
  label: string;
  /** null when there is nothing to measure yet (win rate, response time). */
  value: number | null;
  unit: KpiUnit;
  /** The same figure for the period before; always null for pipeline value. */
  previous: number | null;
  /** One point per agency-local day, oldest first, ending today; empty days are 0. */
  series: { date: string; value: number }[];
};

export type SummaryResponse = { range: DashboardRange; currency: string; kpis: Kpi[] };

export type PipelineStatus = "new" | "quoting" | "quoted" | "won" | "lost";
export type PipelineStage = { status: PipelineStatus; count: number; value_minor: number };
export type PipelineResponse = { currency: string; stages: PipelineStage[] };

export type ActivityItem = {
  id: string;
  /** e.g. "search.flights", "quote.accepted"; unknown kinds render with a generic icon. */
  kind: string;
  summary: string;
  /** ISO 8601 UTC. */
  occurred_at: string;
  actor: { id: string; full_name: string } | null;
  entity_type: string | null;
  entity_id: string | null;
};
export type ActivityResponse = { items: ActivityItem[] };
/** Keyset cursor: items strictly older than (before, before_id). */
export type ActivityCursor = { before: string; before_id: string };

export type Provenance = "LIVE" | "SANDBOX" | "MIXED";
export type MarketPulseRoute = {
  origin: string;
  destination: string;
  current_minor: number;
  previous_minor: number;
  /** One decimal place, e.g. -10.8. */
  change_pct: number;
  samples: number;
  /** Eight weekly medians, oldest first (the last is this week); null for a week without fares. */
  weekly: (number | null)[];
  provenance: Provenance;
};
export type MarketPulseResponse = { currency: string; routes: MarketPulseRoute[] };

export type SupplierHealthRange = "24h" | "7d";
export type SupplierHealth = {
  supplier: string;
  kind: "flights" | "hotels";
  calls: number;
  ok: number;
  success_pct: number;
  /** Successful calls only; null when none succeeded. */
  p50_ms: number | null;
  p95_ms: number | null;
  avg_offers: number | null;
};
export type SupplierHealthResponse = { suppliers: SupplierHealth[] };

export type TeamStats = {
  user: { id: string; full_name: string; role: "owner" | "admin" | "agent" };
  enquiries: number;
  quotes_sent: number;
  won_value_minor: number;
};
export type TeamStatsResponse = { members: TeamStats[] };

export type Departure = {
  enquiry_id: string;
  number: string;
  client: string | null;
  origin: string | null;
  destination: string | null;
  /** Agency-local calendar day, YYYY-MM-DD. */
  depart_date: string;
  travellers: number;
};
export type DeparturesResponse = { items: Departure[] };

export type { Cabin } from "./offers";
/** The Command Center reads the same enquiry and client records as their own pages. */
export type { EnquiryOut as Enquiry, EnquiryList, EnquiryCreate } from "./enquiries";
export type { ClientOut as Client, ClientList, ClientCreate } from "./clients";

export const ACTIVITY_PAGE_SIZE = 20;
export const ROUTE_ENQUIRY_LIMIT = 50;
const CLIENT_SUGGESTIONS = 8;

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const dashboardApi = {
  summary: (range: DashboardRange, signal?: AbortSignal) =>
    apiFetch<SummaryResponse>(`/api/v1/dashboard/summary${query({ range })}`, { signal }),
  pipeline: (signal?: AbortSignal) => apiFetch<PipelineResponse>("/api/v1/dashboard/pipeline", { signal }),
  activity: (cursor: ActivityCursor | null, signal?: AbortSignal) =>
    apiFetch<ActivityResponse>(
      `/api/v1/dashboard/activity${query({ limit: ACTIVITY_PAGE_SIZE, before: cursor?.before, before_id: cursor?.before_id })}`,
      { signal },
    ),
  marketPulse: (signal?: AbortSignal) => apiFetch<MarketPulseResponse>("/api/v1/dashboard/market-pulse", { signal }),
  supplierHealth: (range: SupplierHealthRange, signal?: AbortSignal) =>
    apiFetch<SupplierHealthResponse>(`/api/v1/dashboard/supplier-health${query({ range })}`, { signal }),
  team: (range: DashboardRange, signal?: AbortSignal) =>
    apiFetch<TeamStatsResponse>(`/api/v1/dashboard/team${query({ range })}`, { signal }),
  departures: (signal?: AbortSignal) => apiFetch<DeparturesResponse>("/api/v1/dashboard/departures", { signal }),
  enquiries: (limit: number, signal?: AbortSignal) =>
    apiFetch<EnquiryList>(`/api/v1/enquiries${query({ limit })}`, { signal }),
  createEnquiry: (body: EnquiryCreate) => apiFetch<Enquiry>("/api/v1/enquiries", { method: "POST", body }),
  clients: (term: string, signal?: AbortSignal) =>
    apiFetch<ClientList>(`/api/v1/clients${query({ q: term || undefined, limit: CLIENT_SUGGESTIONS })}`, { signal }),
  createClient: (body: ClientCreate) => apiFetch<Client>("/api/v1/clients", { method: "POST", body }),
};

/**
 * Every dashboard key starts with "dashboard", so one invalidation refreshes the whole Command Center.
 * All of them belong to the session and are dropped by resetSessionState.
 */
export const dashboardKeys = {
  all: ["dashboard"] as const,
  summary: (range: DashboardRange) => ["dashboard", "summary", range] as const,
  pipeline: ["dashboard", "pipeline"] as const,
  activity: ["dashboard", "activity"] as const,
  marketPulse: ["dashboard", "market-pulse"] as const,
  supplierHealth: (range: SupplierHealthRange) => ["dashboard", "supplier-health", range] as const,
  team: (range: DashboardRange) => ["dashboard", "team", range] as const,
  departures: ["dashboard", "departures"] as const,
  routeEnquiries: ["dashboard", "route-enquiries"] as const,
  enquiries: ["enquiries"] as const,
  clients: (term: string) => ["clients", "suggest", term.trim().toLowerCase()] as const,
};

/**
 * Placeholder for a range switch: the figures of the range shown before stay (marked busy) while the new
 * range loads. Never across a session reset, which removes and refetches the same key.
 */
function previousRange<T>(
  key: readonly unknown[],
  previous: T | undefined,
  previousQuery: { queryKey: readonly unknown[] } | undefined,
): T | undefined {
  return previousQuery && JSON.stringify(previousQuery.queryKey) !== JSON.stringify(key) ? previous : undefined;
}

export function summaryQueryOptions(range: DashboardRange) {
  const queryKey = dashboardKeys.summary(range);
  return queryOptions({
    queryKey,
    queryFn: ({ signal }) => dashboardApi.summary(range, signal),
    staleTime: 30_000,
    placeholderData: (previous, previousQuery) => previousRange(queryKey, previous, previousQuery),
  });
}

export const pipelineQueryOptions = queryOptions({
  queryKey: dashboardKeys.pipeline,
  queryFn: ({ signal }) => dashboardApi.pipeline(signal),
  staleTime: 30_000,
});

export const activityQueryOptions = infiniteQueryOptions({
  queryKey: dashboardKeys.activity,
  queryFn: ({ pageParam, signal }) => dashboardApi.activity(pageParam, signal),
  initialPageParam: null as ActivityCursor | null,
  // A short page is the last one; otherwise page back from the oldest item shown.
  getNextPageParam: (last): ActivityCursor | undefined => {
    const oldest = last.items.at(-1);
    return last.items.length < ACTIVITY_PAGE_SIZE || !oldest
      ? undefined
      : { before: oldest.occurred_at, before_id: oldest.id };
  },
  refetchInterval: 20_000,
});

export const marketPulseQueryOptions = queryOptions({
  queryKey: dashboardKeys.marketPulse,
  queryFn: ({ signal }) => dashboardApi.marketPulse(signal),
  staleTime: 5 * 60_000,
});

export function supplierHealthQueryOptions(range: SupplierHealthRange) {
  const queryKey = dashboardKeys.supplierHealth(range);
  return queryOptions({
    queryKey,
    queryFn: ({ signal }) => dashboardApi.supplierHealth(range, signal),
    staleTime: 60_000,
    placeholderData: (previous, previousQuery) => previousRange(queryKey, previous, previousQuery),
  });
}

export function teamStatsQueryOptions(range: DashboardRange) {
  const queryKey = dashboardKeys.team(range);
  return queryOptions({
    queryKey,
    queryFn: ({ signal }) => dashboardApi.team(range, signal),
    staleTime: 60_000,
    placeholderData: (previous, previousQuery) => previousRange(queryKey, previous, previousQuery),
  });
}

export const departuresQueryOptions = queryOptions({
  queryKey: dashboardKeys.departures,
  queryFn: ({ signal }) => dashboardApi.departures(signal),
  staleTime: 60_000,
});

/** The latest enquiries, for the routes on the globe. */
export const routeEnquiriesQueryOptions = queryOptions({
  queryKey: dashboardKeys.routeEnquiries,
  queryFn: ({ signal }) => dashboardApi.enquiries(ROUTE_ENQUIRY_LIMIT, signal),
  staleTime: 60_000,
});

export function clientSuggestionsQueryOptions(term: string) {
  const trimmed = term.trim();
  return queryOptions({
    queryKey: dashboardKeys.clients(trimmed),
    queryFn: ({ signal }) => dashboardApi.clients(trimmed, signal),
    staleTime: 30_000,
  });
}
