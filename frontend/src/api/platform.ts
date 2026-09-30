import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";

/** Public, tenant-free figures about what the platform is connected to (GET /api/v1/platform/facts). */
export type PlatformFacts = {
  airports: number;
  suppliers: { kind: string; connected: number }[];
  routes_with_history: number;
};

export const platformApi = {
  facts: (signal?: AbortSignal) => apiFetch<PlatformFacts>("/api/v1/platform/facts", { signal }),
};

/** Connected suppliers across every kind (flights, hotels, …). */
export function connectedSuppliers(facts: PlatformFacts): number {
  return facts.suppliers.reduce((total, supplier) => total + Math.max(0, supplier.connected), 0);
}

export const platformFactsQueryOptions = queryOptions({
  queryKey: ["platform-facts"] as const,
  queryFn: ({ signal }) => platformApi.facts(signal),
  // The server caches these for five minutes; asking more often gains nothing.
  staleTime: 5 * 60_000,
});
