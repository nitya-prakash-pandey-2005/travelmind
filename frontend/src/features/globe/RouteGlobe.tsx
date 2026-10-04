import { Minus, Pause, Play, Plus, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { Color, MeshPhongMaterial } from "three";
import type { Airport } from "../../api/types";
import { CLEAR_CANVAS, useThemePalette } from "../../theme";
import { useReducedMotion } from "../../ui/useReducedMotion";
import { COUNTRIES, type Country } from "./countries";
import { useElementSize } from "../../lib/useElementSize";
import { planeArcs, useFlyingPlanes } from "./flyingPlanes";
import { useOnScreen } from "./useOnScreen";
import { routeAltitude, useFlyToActiveRoute } from "./useFlyToActiveRoute";

/** `weight` (default 1) thickens a route with more enquiries on it. */
export type GlobeArc = { from: Airport; to: Airport; active: boolean; weight?: number };

/**
 * Stroke width in degrees; null draws a crisp 1px line. Busy or highlighted routes get a hairline tube
 * that thickens gently with enquiry count, capped, so nothing turns into a glowing ribbon.
 */
function arcStroke(arc: GlobeArc): number | null {
  const weight = Number.isFinite(arc.weight) ? Math.max(1, arc.weight ?? 1) : 1;
  if (!arc.active && weight <= 1) return null;
  return (arc.active ? 0.16 : 0.08) + Math.min(weight - 1, 4) * 0.02;
}

type AirportLabel = { kind: "airport"; lat: number; lng: number; text: string; active: boolean };
type CountryLabel = { kind: "country"; lat: number; lng: number; text: string };
type GlobeLabel = AirportLabel | CountryLabel;

/** Each airport once, flagged when any highlighted route touches it. */
function airportLabels(arcs: GlobeArc[]): AirportLabel[] {
  const byCode = new Map<string, AirportLabel>();
  for (const arc of arcs) {
    for (const airport of [arc.from, arc.to]) {
      const seen = byCode.get(airport.iata_code);
      byCode.set(airport.iata_code, {
        kind: "airport",
        lat: airport.latitude,
        lng: airport.longitude,
        text: airport.iata_code,
        active: (seen?.active ?? false) || arc.active,
      });
    }
  }
  return [...byCode.values()];
}

/** A country's label point: the mean of its largest outline (good enough for a name tag). */
function countryLabel(country: Country): CountryLabel | null {
  const name = country.properties?.name;
  if (!name) return null;
  const rings = country.geometry.type === "Polygon" ? [country.geometry.coordinates[0]] : country.geometry.coordinates.map((p) => p[0]);
  const ring = rings.reduce((best, next) => ((next?.length ?? 0) > (best?.length ?? 0) ? next : best), rings[0]);
  if (!ring || ring.length === 0) return null;
  const lng = ring.reduce((sum, point) => sum + (point[0] ?? 0), 0) / ring.length;
  const lat = ring.reduce((sum, point) => sum + (point[1] ?? 0), 0) / ring.length;
  return { kind: "country", lat, lng, text: name };
}

const COUNTRY_LABELS: CountryLabel[] = COUNTRIES.flatMap((country) => {
  const label = countryLabel(country);
  return label ? [label] : [];
});

/** Country names appear once the camera is this close (globe radii above the surface). */
const NAMES_FROM_ALTITUDE = 1.25;
const MIN_ALTITUDE = 0.35;
const MAX_ALTITUDE = 4;

/** Where a showcase globe first looks: over the Gulf, with India, Europe and Singapore in view. */
const SHOWCASE_VIEW = { lat: 24, lng: 52, altitude: 2.15 };
/** Arc height as a share of the route's great-circle angle (the planes ride the same curve). */
const ARC_AUTO_SCALE = 0.45;
/** The working map's home view: India and the Gulf, close enough to read borders. */
const HOME_VIEW = { lat: 22, lng: 66, altitude: 1.9 };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

type RouteGlobeProps = {
  arcs: GlobeArc[];
  /**
   * A decorative globe (the landing page): every arc is highlighted, it keeps turning (unless reduced motion),
   * and it never captures the scroll wheel, so the page scrolls past it.
   */
  showcase?: boolean;
  /** A shorter working map for a side column (the Agent's plan board); the hint line is left out. */
  compact?: boolean;
};

const TOOL =
  "inline-flex h-8 w-8 items-center justify-center rounded-md text-dim transition-colors duration-150 ease-tm hover:bg-hover hover:text-ink";

/**
 * Interactive 3D world map: every country drawn with its border (name on hover, names on screen when zoomed
 * in), a latitude/longitude grid, and great-circle route arcs. Drag to rotate, scroll or use the buttons to
 * zoom. The landing page's showcase keeps the quieter hex-dot look. Lazy-loaded (three.js is large).
 */
export default function RouteGlobe({ arcs, showcase = false, compact = false }: RouteGlobeProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [measureRef, size] = useElementSize<HTMLDivElement>();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const containerRef = useCallback(
    (node: HTMLDivElement | null) => {
      measureRef(node);
      setContainer(node);
    },
    [measureRef],
  );
  // Off screen or in a background tab, the WebGL loop and the planes stop (software rendering in CI and on
  // GPU-less machines makes every frame expensive).
  const onScreen = useOnScreen(container);
  // WebGL can't read CSS variables: colours come from the live palette and follow theme switches.
  const palette = useThemePalette();
  const reducedMotion = useReducedMotion();
  const material = useMemo(() => new MeshPhongMaterial({ color: new Color(palette.globeOcean), shininess: 6 }), [palette.globeOcean]);
  // A theme switch builds a new material; free the old one's GPU resources.
  useEffect(() => () => material.dispose(), [material]);
  const airports = useMemo(() => airportLabels(arcs), [arcs]);
  const active = useMemo(() => (showcase ? undefined : arcs.find((arc) => arc.active)), [arcs, showcase]);
  const ready = size.width > 0 && size.height > 0;
  const [hovered, setHovered] = useState<Country | null>(null);
  const [altitude, setAltitude] = useState(HOME_VIEW.altitude);
  const [spinning, setSpinning] = useState(true);
  const showNames = !showcase && altitude < NAMES_FROM_ALTITUDE;
  const labels = useMemo<GlobeLabel[]>(() => (showNames ? [...COUNTRY_LABELS, ...airports] : airports), [showNames, airports]);

  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (!controls) return;
    controls.autoRotate = !reducedMotion && !active && (showcase || spinning);
    controls.autoRotateSpeed = 0.35;
    controls.minDistance = 100 * (1 + MIN_ALTITUDE);
    controls.maxDistance = 100 * (1 + MAX_ALTITUDE);
    if (showcase) controls.enableZoom = false;
  }, [reducedMotion, active, size.width, showcase, spinning]);

  useEffect(() => {
    if (ready) globeRef.current?.pointOfView(showcase ? SHOWCASE_VIEW : HOME_VIEW, 0);
  }, [showcase, ready]);

  // The camera stops closer for a short route, so the whole route fills the view.
  // With several routes highlighted (the Command Center), keep the wide view that shows them all.
  const single = useMemo(() => arcs.filter((arc) => arc.active).length === 1, [arcs]);
  useFlyToActiveRoute(
    globeRef,
    active,
    ready,
    reducedMotion,
    active && (single || compact) ? routeAltitude(active.from, active.to, compact) : undefined,
  );
  const flying = useMemo(() => planeArcs(arcs), [arcs]);
  useFlyingPlanes(globeRef, flying, palette.ink, ready, reducedMotion, ARC_AUTO_SCALE, !onScreen);

  useEffect(() => {
    const globe = globeRef.current;
    if (!ready || !globe) return;
    if (onScreen) globe.resumeAnimation();
    else globe.pauseAnimation();
  }, [onScreen, ready]);

  const zoomBy = useCallback(
    (factor: number) => {
      const globe = globeRef.current;
      if (!globe) return;
      const view = globe.pointOfView();
      const next = Math.min(MAX_ALTITUDE, Math.max(MIN_ALTITUDE, view.altitude * factor));
      globe.pointOfView({ ...view, altitude: next }, reducedMotion ? 0 : 400);
      setAltitude(next);
    },
    [reducedMotion],
  );

  const resetView = useCallback(() => {
    globeRef.current?.pointOfView(HOME_VIEW, reducedMotion ? 0 : 600);
    setAltitude(HOME_VIEW.altitude);
  }, [reducedMotion]);

  return (
    <div
      ref={containerRef}
      className={
        showcase
          ? "h-full w-full"
          : compact
            ? "relative h-[300px] w-full cursor-grab active:cursor-grabbing"
            : "relative h-[440px] w-full cursor-grab active:cursor-grabbing lg:h-[520px]"
      }
    >
      {ready &&
        (showcase ? (
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
            arcColor={() => palette.primary}
            arcStroke={0.22}
            arcDashLength={0.6}
            arcDashGap={0.12}
            arcDashAnimateTime={reducedMotion ? 0 : 3200}
            arcAltitudeAutoScale={ARC_AUTO_SCALE}
            labelsData={airports}
            labelLat={(d: object) => (d as GlobeLabel).lat}
            labelLng={(d: object) => (d as GlobeLabel).lng}
            labelText={(d: object) => (d as GlobeLabel).text}
            labelSize={0.9}
            labelDotRadius={0.3}
            labelColor={() => palette.primary}
            labelResolution={2}
          />
        ) : (
          <Globe
            ref={globeRef}
            width={size.width}
            height={size.height}
            backgroundColor={CLEAR_CANVAS}
            globeMaterial={material}
            showAtmosphere
            atmosphereColor={palette.primary}
            atmosphereAltitude={0.12}
            showGraticules
            polygonsData={COUNTRIES}
            polygonCapColor={(d: object) => (d === hovered ? palette.chart2 : palette.globeLand)}
            polygonSideColor={() => palette.globeOcean}
            polygonStrokeColor={() => palette.lineStrong}
            polygonAltitude={(d: object) => (d === hovered ? 0.02 : 0.006)}
            polygonLabel={(d: object) => {
              const name = (d as Country).properties?.name;
              return name
                ? `<div style="padding:4px 8px;border-radius:6px;font:500 12px var(--tm-font-sans);background:var(--tm-surface);color:var(--tm-ink);border:1px solid var(--tm-line-strong)">${escapeHtml(name)}</div>`
                : "";
            }}
            onPolygonHover={(d: object | null) => setHovered((d as Country | null) ?? null)}
            polygonsTransitionDuration={reducedMotion ? 0 : 200}
            arcsData={arcs}
            arcStartLat={(d: object) => (d as GlobeArc).from.latitude}
            arcStartLng={(d: object) => (d as GlobeArc).from.longitude}
            arcEndLat={(d: object) => (d as GlobeArc).to.latitude}
            arcEndLng={(d: object) => (d as GlobeArc).to.longitude}
            arcColor={(d: object) => ((d as GlobeArc).active ? palette.primary : palette.dim)}
            arcStroke={(d: object) => arcStroke(d as GlobeArc)}
            arcDashLength={0.9}
            arcDashGap={0.25}
            arcDashAnimateTime={reducedMotion ? 0 : 4200}
            arcAltitudeAutoScale={ARC_AUTO_SCALE}
            labelsData={labels}
            labelLat={(d: object) => (d as GlobeLabel).lat}
            labelLng={(d: object) => (d as GlobeLabel).lng}
            labelText={(d: object) => (d as GlobeLabel).text}
            labelSize={(d: object) => ((d as GlobeLabel).kind === "country" ? 0.42 : 0.9)}
            labelDotRadius={(d: object) => ((d as GlobeLabel).kind === "country" ? 0 : 0.3)}
            labelColor={(d: object) => {
              const label = d as GlobeLabel;
              if (label.kind === "country") return palette.faint;
              return label.active ? palette.primary : palette.ink;
            }}
            labelAltitude={0.012}
            labelResolution={2}
            onZoom={(view: { altitude: number }) => setAltitude(view.altitude)}
          />
        ))}
      {ready && !showcase && (
        <div
          role="toolbar"
          aria-label="Map controls"
          className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-lg border border-line bg-surface p-1 shadow-raise"
        >
          <button type="button" aria-label="Zoom in" className={TOOL} onClick={() => zoomBy(0.7)}>
            <Plus size={15} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Zoom out" className={TOOL} onClick={() => zoomBy(1.4)}>
            <Minus size={15} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Reset view" className={TOOL} onClick={resetView}>
            <RotateCcw size={15} aria-hidden="true" />
          </button>
          {!reducedMotion && (
            <button
              type="button"
              aria-label={spinning ? "Stop rotating" : "Start rotating"}
              aria-pressed={spinning}
              className={TOOL}
              onClick={() => setSpinning((value) => !value)}
            >
              {spinning ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
            </button>
          )}
        </div>
      )}
      {ready && !showcase && !compact && (
        <p className="pointer-events-none absolute bottom-4 left-3 text-[11px] text-faint max-sm:hidden">
          {hovered?.properties?.name ?? "Drag to rotate · scroll to zoom · hover a country for its name"}
        </p>
      )}
    </div>
  );
}
