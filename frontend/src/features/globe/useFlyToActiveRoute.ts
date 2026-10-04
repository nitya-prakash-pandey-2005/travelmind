import { useEffect, type RefObject } from "react";
import type { GlobeMethods } from "react-globe.gl";
import type { Airport } from "../../api/types";
import { midpoint } from "../route/geo";

const ROUTE_ALTITUDE = 1.9;
const FLIGHT_MS = 1200;

/**
 * Points the camera at the active route's midpoint. Runs once the globe is mounted and sized (`ready`),
 * so a route selected before the dashboard mounted is still framed, and keys on the airport pair rather
 * than object identity so rebuilding the arcs for the same route doesn't re-fly the camera.
 */
export function useFlyToActiveRoute(
  globeRef: RefObject<Pick<GlobeMethods, "pointOfView"> | null | undefined>,
  active: { from: Airport; to: Airport } | undefined,
  ready: boolean,
  reducedMotion: boolean,
  /** How far above the route the camera stops (globe radii); closer for a small map. */
  altitude: number = ROUTE_ALTITUDE,
) {
  const mid = active ? midpoint(active.from, active.to) : null;
  const routeKey = active ? `${active.from.iata_code}-${active.to.iata_code}` : null;
  const lat = mid?.lat;
  const lng = mid?.lng;

  useEffect(() => {
    const globe = globeRef.current;
    if (!ready || !globe || routeKey === null || lat === undefined || lng === undefined) return;
    globe.pointOfView({ lat, lng, altitude }, reducedMotion ? 0 : FLIGHT_MS);
  }, [globeRef, ready, routeKey, lat, lng, reducedMotion, altitude]);
}
