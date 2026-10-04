import type { Position } from "geojson";
import { useMemo } from "react";
import type { Airport } from "../../api/types";
import { greatCirclePoints } from "../route/geo";
import { COUNTRIES } from "./countries";
import type { GlobeArc } from "./RouteGlobe";

/** Latitudes shown: the inhabited world, without the empty polar bands. */
const NORTH = 84;
const SOUTH = -58;
const WORLD_W = 360;
const WORLD_H = NORTH - SOUTH;
const ASPECT = WORLD_W / WORLD_H;
/** The narrowest view (degrees of longitude), so a short domestic route keeps its surroundings. */
const MIN_SPAN = 48;

type Box = { x: number; y: number; w: number; h: number };

/** Equirectangular projection into map units: x 0…360 west to east, y 0…142 north to south. */
const project = (lat: number, lng: number): [number, number] => [lng + 180, NORTH - lat];

/** A ring as SVG path commands; a jump across the antimeridian starts a new subpath instead of a streak. */
function ringPath(ring: Position[]): string {
  let d = "";
  let prevLng: number | null = null;
  for (const [lng = 0, lat = 0] of ring) {
    const [x, y] = project(lat, lng);
    const jump = prevLng === null || Math.abs(lng - prevLng) > 180;
    d += `${jump ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    prevLng = lng;
  }
  return `${d}Z`;
}

/** Land as one path, built once when the map module loads. */
const LAND_PATH = COUNTRIES.map(({ geometry }) =>
  (geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates)
    .map((polygon) => polygon.map(ringPath).join(""))
    .join(""),
).join("");

/** The great circle as a polyline, split where it wraps across the antimeridian. */
function arcPath(from: Airport, to: Airport): string {
  let d = "";
  let prevLng: number | null = null;
  for (const { lat, lng } of greatCirclePoints(from, to)) {
    const [x, y] = project(lat, lng);
    const jump = prevLng === null || Math.abs(lng - prevLng) > 180;
    d += `${jump ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    prevLng = lng;
  }
  return d;
}

/** A view around every airport with some margin, at the map's aspect ratio, kept inside the world. */
function viewFor(airports: readonly Airport[]): Box {
  if (airports.length === 0) return { x: 0, y: 0, w: WORLD_W, h: WORLD_H };
  const xs = airports.map((a) => project(a.latitude, a.longitude)[0]);
  const ys = airports.map((a) => project(a.latitude, a.longitude)[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = Math.min(WORLD_W, Math.max(MIN_SPAN, (maxX - minX) * 1.5, (maxY - minY) * 1.5 * ASPECT));
  const h = w / ASPECT;
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), Math.max(0, max));
  return {
    x: clamp((minX + maxX) / 2 - w / 2, WORLD_W - w),
    y: clamp((minY + maxY) / 2 - h / 2, WORLD_H - h),
    w,
    h,
  };
}

function uniqueAirports(arcs: readonly GlobeArc[]): { airport: Airport; active: boolean }[] {
  const byCode = new Map<string, { airport: Airport; active: boolean }>();
  for (const arc of arcs) {
    for (const airport of [arc.from, arc.to]) {
      const seen = byCode.get(airport.iata_code);
      byCode.set(airport.iata_code, { airport, active: (seen?.active ?? false) || arc.active });
    }
  }
  return [...byCode.values()];
}

/**
 * The route map without WebGL: a flat (equirectangular) map with muted land, 1px great-circle routes and
 * IATA labels, framed around the airports in play. Won or plotted routes are drawn in the accent colour.
 */
export default function FlatRouteMap({ arcs }: { arcs: GlobeArc[] }) {
  const airports = useMemo(() => uniqueAirports(arcs), [arcs]);
  const view = useMemo(() => viewFor(airports.map((a) => a.airport)), [airports]);
  // Inactive routes first so the highlighted ones draw on top.
  const ordered = useMemo(() => [...arcs].sort((a, b) => Number(a.active) - Number(b.active)), [arcs]);
  const summary =
    arcs.length === 0
      ? "Map with no routes yet"
      : `Map of ${arcs.length} ${arcs.length === 1 ? "route" : "routes"}: ${arcs
          .map((arc) => `${arc.from.iata_code} to ${arc.to.iata_code}${arc.active ? " (highlighted)" : ""}`)
          .join(", ")}`;
  const pct = (value: number, origin: number, span: number) => `${(((value - origin) / span) * 100).toFixed(3)}%`;

  return (
    <div role="img" aria-label={summary} className="relative w-full overflow-hidden rounded-md bg-[var(--tm-globe-ocean)]" style={{ aspectRatio: `${ASPECT}` }}>
      <svg
        aria-hidden="true"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
      >
        <path d={LAND_PATH} fill="var(--tm-globe-land)" fillRule="evenodd" />
        {ordered.map((arc) => (
          <path
            key={`${arc.from.iata_code}-${arc.to.iata_code}`}
            data-arc={arc.active ? "active" : "other"}
            d={arcPath(arc.from, arc.to)}
            fill="none"
            stroke={arc.active ? "var(--tm-primary)" : "var(--tm-text-3)"}
            strokeOpacity={arc.active ? 1 : 0.8}
            strokeWidth={1}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {/* Dots and labels are HTML so they stay a constant size however far the map is zoomed. */}
      {airports.map(({ airport, active }) => {
        const [x, y] = project(airport.latitude, airport.longitude);
        return (
          <span
            key={airport.iata_code}
            aria-hidden="true"
            className="absolute flex -translate-x-[3px] -translate-y-[3px] items-center gap-1"
            style={{ left: pct(x, view.x, view.w), top: pct(y, view.y, view.h) }}
          >
            <span className={active ? "h-1.5 w-1.5 rounded-full bg-primary" : "h-1.5 w-1.5 rounded-full bg-faint"} />
            <span className="font-mono text-[10px] leading-none text-dim">{airport.iata_code}</span>
          </span>
        );
      })}
    </div>
  );
}
