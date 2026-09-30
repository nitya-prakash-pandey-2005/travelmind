import { useEffect, useMemo, useRef } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { Color, MeshPhongMaterial } from "three";
import type { Airport } from "../../api/types";
import { useTheme, type Theme } from "../../ui/theme";
import { useReducedMotion } from "../../ui/useReducedMotion";
import { COUNTRIES } from "./countries";
import { useElementSize } from "../../lib/useElementSize";
import { useFlyToActiveRoute } from "./useFlyToActiveRoute";

/** `weight` (default 1) thickens a route with more enquiries on it. */
export type GlobeArc = { from: Airport; to: Airport; active: boolean; weight?: number };

/** Stroke width: active arcs stand out; others thicken gently with weight, capped. */
function arcStroke(arc: GlobeArc): number {
  const weight = Number.isFinite(arc.weight) ? Math.max(1, arc.weight ?? 1) : 1;
  const extra = Math.min(weight - 1, 4) * 0.12;
  return (arc.active ? 0.9 : 0.35) + extra;
}

type GlobeColors = { primary: string; ai: string; dim: string; land: string; ocean: string };

function readColors(_theme: Theme): GlobeColors {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    primary: read("--tm-primary"),
    ai: read("--tm-ai"),
    dim: read("--tm-text-dim"),
    land: read("--tm-globe-land"),
    ocean: read("--tm-globe-ocean"),
  };
}

function uniqueAirports(arcs: GlobeArc[]): Airport[] {
  const byCode = new Map<string, Airport>();
  for (const arc of arcs) {
    byCode.set(arc.from.iata_code, arc.from);
    byCode.set(arc.to.iata_code, arc.to);
  }
  return [...byCode.values()];
}

/** Hex-dotted 3D globe with animated great-circle arcs. Lazy-loaded (three.js is large). */
export default function RouteGlobe({ arcs }: { arcs: GlobeArc[] }) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [containerRef, size] = useElementSize<HTMLDivElement>();
  const [theme] = useTheme();
  const reducedMotion = useReducedMotion();
  const colors = useMemo(() => readColors(theme), [theme]);
  const material = useMemo(() => new MeshPhongMaterial({ color: new Color(colors.ocean), shininess: 6 }), [colors.ocean]);
  const labels = useMemo(() => uniqueAirports(arcs), [arcs]);
  const active = useMemo(() => arcs.find((arc) => arc.active), [arcs]);

  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (!controls) return;
    controls.autoRotate = !reducedMotion && !active;
    controls.autoRotateSpeed = 0.35;
  }, [reducedMotion, active, size.width]);

  useFlyToActiveRoute(globeRef, active, size.width > 0 && size.height > 0, reducedMotion);

  return (
    <div ref={containerRef} className="h-full min-h-[340px] w-full">
      {size.width > 0 && size.height > 0 && (
        <Globe
          ref={globeRef}
          width={size.width}
          height={size.height}
          backgroundColor="rgba(0,0,0,0)"
          globeMaterial={material}
          showAtmosphere
          atmosphereColor={colors.primary}
          atmosphereAltitude={0.16}
          hexPolygonsData={COUNTRIES}
          hexPolygonResolution={3}
          hexPolygonMargin={0.55}
          hexPolygonColor={() => colors.land}
          arcsData={arcs}
          arcStartLat={(d: object) => (d as GlobeArc).from.latitude}
          arcStartLng={(d: object) => (d as GlobeArc).from.longitude}
          arcEndLat={(d: object) => (d as GlobeArc).to.latitude}
          arcEndLng={(d: object) => (d as GlobeArc).to.longitude}
          arcColor={(d: object) => ((d as GlobeArc).active ? [colors.primary, colors.ai] : colors.dim)}
          arcStroke={(d: object) => arcStroke(d as GlobeArc)}
          arcDashLength={0.45}
          arcDashGap={0.18}
          arcDashAnimateTime={reducedMotion ? 0 : 2200}
          arcAltitudeAutoScale={0.45}
          labelsData={labels}
          labelLat={(d: object) => (d as Airport).latitude}
          labelLng={(d: object) => (d as Airport).longitude}
          labelText={(d: object) => (d as Airport).iata_code}
          labelSize={1.1}
          labelDotRadius={0.45}
          labelColor={() => colors.primary}
          labelResolution={2}
        />
      )}
    </div>
  );
}
