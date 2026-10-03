import { useEffect, useMemo, useRef } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { Color, MeshPhongMaterial } from "three";
import type { Airport } from "../../api/types";
import { CLEAR_CANVAS, useThemePalette } from "../../theme";
import { useReducedMotion } from "../../ui/useReducedMotion";
import { COUNTRIES } from "./countries";
import { useElementSize } from "../../lib/useElementSize";
import { useFlyToActiveRoute } from "./useFlyToActiveRoute";

/** `weight` (default 1) thickens a route with more enquiries on it. */
export type GlobeArc = { from: Airport; to: Airport; active: boolean; weight?: number };

/**
 * Stroke width in degrees; null draws a crisp 1px line. Busy or highlighted routes get a hairline tube
 * that thickens gently with enquiry count, capped, so nothing turns into a glowing ribbon.
 */
function arcStroke(arc: GlobeArc): number | null {
  const weight = Number.isFinite(arc.weight) ? Math.max(1, arc.weight ?? 1) : 1;
  if (!arc.active && weight <= 1) return null;
  return (arc.active ? 0.28 : 0.16) + Math.min(weight - 1, 4) * 0.04;
}

type GlobeLabel = { airport: Airport; active: boolean };

/** Each airport once, flagged when any highlighted route touches it. */
function uniqueAirports(arcs: GlobeArc[]): GlobeLabel[] {
  const byCode = new Map<string, GlobeLabel>();
  for (const arc of arcs) {
    for (const airport of [arc.from, arc.to]) {
      const seen = byCode.get(airport.iata_code);
      byCode.set(airport.iata_code, { airport, active: (seen?.active ?? false) || arc.active });
    }
  }
  return [...byCode.values()];
}

/** Where a showcase globe first looks: over the Gulf, with India, Europe and Singapore in view. */
const SHOWCASE_VIEW = { lat: 24, lng: 52, altitude: 2.15 };

type RouteGlobeProps = {
  arcs: GlobeArc[];
  /**
   * A decorative globe (the landing page): every arc is highlighted, it keeps turning (unless reduced motion),
   * and it never captures the scroll wheel, so the page scrolls past it.
   */
  showcase?: boolean;
};

/**
 * Hex-dotted 3D globe with thin great-circle arcs: muted land, a faint rim instead of a glow, highlighted
 * routes in the accent colour and the rest in tertiary grey. Lazy-loaded (three.js is large).
 */
export default function RouteGlobe({ arcs, showcase = false }: RouteGlobeProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [containerRef, size] = useElementSize<HTMLDivElement>();
  // WebGL can't read CSS variables: colours come from the live palette and follow theme switches.
  const palette = useThemePalette();
  const reducedMotion = useReducedMotion();
  const material = useMemo(() => new MeshPhongMaterial({ color: new Color(palette.globeOcean), shininess: 6 }), [palette.globeOcean]);
  // A theme switch builds a new material; free the old one's GPU resources.
  useEffect(() => () => material.dispose(), [material]);
  const labels = useMemo(() => uniqueAirports(arcs), [arcs]);
  const active = useMemo(() => (showcase ? undefined : arcs.find((arc) => arc.active)), [arcs, showcase]);
  const ready = size.width > 0 && size.height > 0;

  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (!controls) return;
    controls.autoRotate = !reducedMotion && !active;
    controls.autoRotateSpeed = 0.35;
    if (showcase) controls.enableZoom = false;
  }, [reducedMotion, active, size.width, showcase]);

  useEffect(() => {
    if (showcase && ready) globeRef.current?.pointOfView(SHOWCASE_VIEW, 0);
  }, [showcase, ready]);

  useFlyToActiveRoute(globeRef, active, ready, reducedMotion);

  return (
    <div ref={containerRef} className={showcase ? "h-full w-full" : "h-full min-h-[300px] w-full"}>
      {ready && (
        <Globe
          ref={globeRef}
          width={size.width}
          height={size.height}
          backgroundColor={CLEAR_CANVAS}
          globeMaterial={material}
          showAtmosphere
          atmosphereColor={palette.lineStrong}
          atmosphereAltitude={0.06}
          hexPolygonsData={COUNTRIES}
          hexPolygonResolution={3}
          hexPolygonMargin={0.6}
          hexPolygonColor={() => palette.globeLand}
          arcsData={arcs}
          arcStartLat={(d: object) => (d as GlobeArc).from.latitude}
          arcStartLng={(d: object) => (d as GlobeArc).from.longitude}
          arcEndLat={(d: object) => (d as GlobeArc).to.latitude}
          arcEndLng={(d: object) => (d as GlobeArc).to.longitude}
          arcColor={(d: object) => (showcase || (d as GlobeArc).active ? palette.primary : palette.faint)}
          arcStroke={(d: object) => (showcase ? 0.22 : arcStroke(d as GlobeArc))}
          arcDashLength={0.6}
          arcDashGap={0.12}
          arcDashAnimateTime={reducedMotion ? 0 : 3200}
          arcAltitudeAutoScale={0.45}
          labelsData={labels}
          labelLat={(d: object) => (d as GlobeLabel).airport.latitude}
          labelLng={(d: object) => (d as GlobeLabel).airport.longitude}
          labelText={(d: object) => (d as GlobeLabel).airport.iata_code}
          labelSize={0.9}
          labelDotRadius={0.3}
          labelColor={(d: object) => (showcase || (d as GlobeLabel).active ? palette.primary : palette.dim)}
          labelResolution={2}
        />
      )}
    </div>
  );
}
