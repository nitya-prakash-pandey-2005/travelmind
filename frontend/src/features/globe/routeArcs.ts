import type { Airport } from "../../api/types";
import type { GlobeArc } from "./RouteGlobe";

/** Anything with a route and a pipeline status: an enquiry. */
export type RoutedRecord = { origin: string | null; destination: string | null; status: string };

/** One origin → destination pair across records: how many, and whether any of them was won. */
export type RouteSummary = { origin: string; destination: string; count: number; won: boolean };

/** Distinct routes, busiest first (won routes before others on a tie), skipping incomplete or looping ones. */
export function summariseRoutes(records: readonly RoutedRecord[]): RouteSummary[] {
  const routes = new Map<string, RouteSummary>();
  for (const { origin, destination, status } of records) {
    if (!origin || !destination || origin === destination) continue;
    const key = `${origin}-${destination}`;
    const route = routes.get(key) ?? { origin, destination, count: 0, won: false };
    route.count += 1;
    route.won ||= status === "won";
    routes.set(key, route);
  }
  return [...routes.values()].sort((a, b) => b.count - a.count || Number(b.won) - Number(a.won));
}

/**
 * Globe arcs for the agency's routes, weighted by enquiry count, won routes active. The route being
 * plotted (if any) comes first and is active. Routes whose airports aren't resolved yet are left out.
 */
export function routeArcs(
  routes: readonly RouteSummary[],
  airports: ReadonlyMap<string, Airport>,
  selection: { origin: Airport | null; destination: Airport | null },
): GlobeArc[] {
  const { origin, destination } = selection;
  const plotted = origin && destination && origin.iata_code !== destination.iata_code ? { origin, destination } : null;
  const arcs: GlobeArc[] = [];
  if (plotted) arcs.push({ from: plotted.origin, to: plotted.destination, active: true });
  // Won routes first so the globe's fly-to lands on business that closed.
  const ordered = [...routes.filter((r) => r.won), ...routes.filter((r) => !r.won)];
  for (const route of ordered) {
    if (plotted && route.origin === plotted.origin.iata_code && route.destination === plotted.destination.iata_code) continue;
    const from = airports.get(route.origin);
    const to = airports.get(route.destination);
    if (from && to) arcs.push({ from, to, active: route.won, weight: route.count });
  }
  return arcs;
}
