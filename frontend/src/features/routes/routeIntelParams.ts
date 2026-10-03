import type { Cabin } from "../../api/offers";

/**
 * The route on screen, from the address (/app/routes?origin=DEL&destination=BOM&cabin=business), so a route
 * can be bookmarked and shared. Anything malformed is dropped on its own; the same airport twice keeps only
 * the origin (the server refuses such a route).
 */
export type RouteIntelSearch = {
  origin?: string;
  destination?: string;
  cabin?: Cabin;
};

export const CABIN_VALUES: readonly Cabin[] = ["economy", "premium_economy", "business", "first"];

function airportCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z]{3}$/.test(value) ? value.toUpperCase() : undefined;
}

export function validateRouteIntelSearch(search: Record<string, unknown>): RouteIntelSearch {
  const origin = airportCode(search.origin);
  const destination = airportCode(search.destination);
  return {
    origin,
    destination: destination === origin ? undefined : destination,
    cabin: CABIN_VALUES.find((cabin) => cabin === search.cabin),
  };
}
