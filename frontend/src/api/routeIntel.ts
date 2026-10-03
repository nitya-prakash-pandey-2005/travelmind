import { queryOptions, skipToken } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { Cabin } from "./offers";
import { queryString } from "./workspaceCache";

/** Route fare intelligence, field for field with backend/src/travelmind/fareintel/routes.py. */

export type DaysOutBucket = "0-7" | "8-21" | "22-45" | "46-90" | "91+";
export const DAYS_OUT_BUCKETS: readonly DaysOutBucket[] = ["0-7", "8-21", "22-45", "46-90", "91+"];
/** "market": live or cached fares; "sandbox": demonstration fares, used only when no market fares exist. */
export type FareFamily = "market" | "sandbox";

/** One local day's fares (one traveller, one way), minor units of the route currency. */
export type DailyFares = { date: string; p25_minor: number; median_minor: number; p75_minor: number; samples: number };
export type DaysOutFares = { bucket: DaysOutBucket; median_minor: number; samples: number };
export type CarrierFares = { code: string; samples: number; median_minor: number };
/** One of the agency's own searches of the route: the cheapest offer per traveller. */
export type RouteSearch = { created_at: string; cheapest_minor: number; adults: number };

export type RouteIntel = {
  origin: string;
  destination: string;
  cabin: Cabin;
  /** The route's currency (its origin's), which may differ from the agency's. */
  currency: string;
  /** null when the route has no fares yet; every list is then empty. */
  family: FareFamily | null;
  /** Last 60 local days, oldest first, days with fares only. */
  daily: DailyFares[];
  /** In bucket order, buckets with fares only. */
  by_days_out: DaysOutFares[];
  /** Top 8 by samples. */
  carriers: CarrierFares[];
  /** Newest first, at most 20. */
  your_searches: RouteSearch[];
  /** The family's latest observation, truncated to the agency-local hour. */
  updated_at: string | null;
};

export type RouteIntelRequest = {
  origin: string | null | undefined;
  destination: string | null | undefined;
  cabin?: Cabin;
};

export const routeIntelApi = {
  intel: (origin: string, destination: string, cabin: Cabin, signal?: AbortSignal) =>
    apiFetch<RouteIntel>(`/api/v1/routes/intel${queryString({ origin, destination, cabin })}`, { signal }),
};

/** Under the session like every workspace key, so resetSessionState drops it. */
export const routeIntelKeys = {
  all: ["route-intel"] as const,
  intel: (origin: string, destination: string, cabin: Cabin) => ["route-intel", origin, destination, cabin] as const,
};

/** Idle until both airports are chosen and differ (the server would 422 the same airport twice). */
export function routeIntelQueryOptions({ origin, destination, cabin = "economy" }: RouteIntelRequest) {
  const from = origin?.trim().toUpperCase() ?? "";
  const to = destination?.trim().toUpperCase() ?? "";
  const ready = from !== "" && to !== "" && from !== to;
  return queryOptions({
    queryKey: routeIntelKeys.intel(from, to, cabin),
    queryFn: ready ? ({ signal }) => routeIntelApi.intel(from, to, cabin, signal) : skipToken,
    staleTime: 5 * 60_000,
  });
}
