import { useCallback, useState } from "react";
import type { Airport } from "../../api/types";

export type RecentRoute = { origin: Airport; destination: Airport; scannedAt: string };

const MAX_ROUTES = 8;
const keyFor = (userId: string) => `tm-recent-routes:${userId}`;

function isAirport(value: unknown): value is Airport {
  if (typeof value !== "object" || value === null) return false;
  const a = value as Record<string, unknown>;
  return (
    typeof a.iata_code === "string" &&
    typeof a.name === "string" &&
    typeof a.latitude === "number" &&
    typeof a.longitude === "number"
  );
}

function isRecentRoute(value: unknown): value is RecentRoute {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return isAirport(r.origin) && isAirport(r.destination) && typeof r.scannedAt === "string";
}

export function loadRecentRoutes(userId: string): RecentRoute[] {
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecentRoute).slice(0, MAX_ROUTES) : [];
  } catch {
    return [];
  }
}

export function recordRecentRoute(
  userId: string,
  origin: Airport,
  destination: Airport,
  now: Date = new Date(),
): RecentRoute[] {
  const sameRoute = (r: RecentRoute) =>
    r.origin.iata_code === origin.iata_code && r.destination.iata_code === destination.iata_code;
  const next = [
    { origin, destination, scannedAt: now.toISOString() },
    ...loadRecentRoutes(userId).filter((r) => !sameRoute(r)),
  ].slice(0, MAX_ROUTES);
  try {
    window.localStorage.setItem(keyFor(userId), JSON.stringify(next));
  } catch {
    // Storage blocked: history lasts for this page view only.
  }
  return next;
}

export function useRecentRoutes(userId: string) {
  const [routes, setRoutes] = useState(() => loadRecentRoutes(userId));
  const record = useCallback(
    (origin: Airport, destination: Airport) => setRoutes(recordRecentRoute(userId, origin, destination)),
    [userId],
  );
  return { routes, record };
}
