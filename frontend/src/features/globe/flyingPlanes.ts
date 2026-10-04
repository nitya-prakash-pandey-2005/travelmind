import { useEffect, type RefObject } from "react";
import type { GlobeMethods } from "react-globe.gl";
import { CanvasTexture, CubicBezierCurve3, Sprite, SpriteMaterial, Vector3 } from "three";
import type { GlobeArc } from "./RouteGlobe";

/** At most this many planes fly at once, so a busy map stays calm. */
export const MAX_PLANES = 4;
/** One leg takes this long; the plane rests a moment at the destination, then flies again. */
const FLIGHT_MS = 6500;
const REST_MS = 900;
/** Plane size as a share of the camera's distance, so it looks the same size at every zoom level. */
const PLANE_SCALE = 0.024;

type LngLat = [number, number];

const RAD = Math.PI / 180;

function toUnit([lng, lat]: LngLat): [number, number, number] {
  const phi = lat * RAD;
  const lambda = lng * RAD;
  return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
}

/** Great-circle angle between two points, in radians (same as d3's geoDistance). */
export function greatCircleAngle(a: LngLat, b: LngLat): number {
  const [ax, ay, az] = toUnit(a);
  const [bx, by, bz] = toUnit(b);
  const dot = Math.min(1, Math.max(-1, ax * bx + ay * by + az * bz));
  return Math.acos(dot);
}

/** The point a fraction `t` of the way along the great circle from `a` to `b` (as d3's geoInterpolate). */
export function interpolateGreatCircle(a: LngLat, b: LngLat, t: number): LngLat {
  const angle = greatCircleAngle(a, b);
  if (angle === 0) return a;
  const [ax, ay, az] = toUnit(a);
  const [bx, by, bz] = toUnit(b);
  const k1 = Math.sin((1 - t) * angle) / Math.sin(angle);
  const k2 = Math.sin(t * angle) / Math.sin(angle);
  const x = k1 * ax + k2 * bx;
  const y = k1 * ay + k2 * by;
  const z = k1 * az + k2 * bz;
  return [Math.atan2(y, x) / RAD, Math.atan2(z, Math.hypot(x, y)) / RAD];
}

/**
 * The same cubic curve three-globe draws for an arc with automatic altitude, so the plane rides exactly
 * on the line: control points a quarter and three quarters of the way along, raised 1.5 × the apex.
 */
export function arcCurve(
  getCoords: GlobeMethods["getCoords"],
  arc: GlobeArc,
  altitudeAutoScale: number,
): CubicBezierCurve3 {
  const start: LngLat = [arc.from.longitude, arc.from.latitude];
  const end: LngLat = [arc.to.longitude, arc.to.latitude];
  const apex = (greatCircleAngle(start, end) / 2) * altitudeAutoScale;
  const control = apex * 1.5;
  const vec = ([lng, lat]: LngLat, alt: number) => {
    const { x, y, z } = getCoords(lat, lng, alt);
    return new Vector3(x, y, z);
  };
  return new CubicBezierCurve3(
    vec(start, 0),
    vec(interpolateGreatCircle(start, end, 0.25), control),
    vec(interpolateGreatCircle(start, end, 0.75), control),
    vec(end, 0),
  );
}

/** A small top-down airliner, nose pointing right, drawn once per colour. */
function planeTexture(color: string): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.translate(size / 2, size / 2);
    ctx.fillStyle = color;
    ctx.beginPath();
    // Fuselage.
    ctx.moveTo(52, 0);
    ctx.quadraticCurveTo(46, -7, 34, -7);
    ctx.lineTo(-40, -6);
    ctx.quadraticCurveTo(-50, 0, -40, 6);
    ctx.lineTo(34, 7);
    ctx.quadraticCurveTo(46, 7, 52, 0);
    ctx.fill();
    // Main wings.
    ctx.beginPath();
    ctx.moveTo(14, -6);
    ctx.lineTo(-10, -50);
    ctx.lineTo(-22, -50);
    ctx.lineTo(-8, -6);
    ctx.moveTo(14, 6);
    ctx.lineTo(-10, 50);
    ctx.lineTo(-22, 50);
    ctx.lineTo(-8, 6);
    ctx.fill();
    // Tail.
    ctx.beginPath();
    ctx.moveTo(-30, -5);
    ctx.lineTo(-44, -22);
    ctx.lineTo(-50, -22);
    ctx.lineTo(-42, -4);
    ctx.moveTo(-30, 5);
    ctx.lineTo(-44, 22);
    ctx.lineTo(-50, 22);
    ctx.lineTo(-42, 4);
    ctx.fill();
  }
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

type Flight = { sprite: Sprite; curve: CubicBezierCurve3; offset: number };

/** Which arcs get a plane: the highlighted ones (or, with none highlighted, the first few). */
export function planeArcs(arcs: GlobeArc[]): GlobeArc[] {
  const active = arcs.filter((arc) => arc.active);
  return (active.length > 0 ? active : arcs).slice(0, MAX_PLANES);
}

/**
 * Flies a small plane along each chosen arc, nose along the route. Sprites live in the globe's own scene and
 * are moved in an animation frame loop (no React re-render per frame). With reduced motion the plane rests
 * at the middle of its route.
 */
export function useFlyingPlanes(
  globeRef: RefObject<GlobeMethods | undefined>,
  arcs: GlobeArc[],
  color: string,
  ready: boolean,
  reducedMotion: boolean,
  altitudeAutoScale: number,
) {
  useEffect(() => {
    const globe = globeRef.current;
    if (!ready || !globe || arcs.length === 0) return;
    const scene = globe.scene();
    const camera = globe.camera();
    const texture = planeTexture(color);
    const flights: Flight[] = arcs.map((arc, index) => {
      const material = new SpriteMaterial({ map: texture, depthWrite: false, transparent: true });
      const sprite = new Sprite(material);
      sprite.renderOrder = 10;
      scene.add(sprite);
      return { sprite, curve: arcCurve(globe.getCoords, arc, altitudeAutoScale), offset: index / Math.max(arcs.length, 1) };
    });

    const here = new Vector3();
    const ahead = new Vector3();
    const place = (flight: Flight, t: number) => {
      flight.curve.getPoint(t, here);
      flight.curve.getPoint(Math.min(1, t + 0.01), ahead);
      flight.sprite.position.copy(here);
      const size = camera.position.length() * PLANE_SCALE;
      flight.sprite.scale.set(size, size, 1);
      // Point the nose along the route as it looks on screen.
      const a = here.clone().project(camera);
      const b = ahead.clone().project(camera);
      const material = flight.sprite.material as SpriteMaterial;
      if (b.x !== a.x || b.y !== a.y) material.rotation = Math.atan2(b.y - a.y, b.x - a.x);
    };

    let frame = 0;
    const cycle = FLIGHT_MS + REST_MS;
    const tick = (now: number) => {
      for (const flight of flights) {
        const phase = ((now / cycle + flight.offset) % 1) * cycle;
        place(flight, Math.min(1, phase / FLIGHT_MS));
      }
      frame = requestAnimationFrame(tick);
    };
    if (reducedMotion) {
      // Still keep the nose aligned as the user rotates the globe, without moving the plane.
      const still = () => {
        for (const flight of flights) place(flight, 0.5);
        frame = requestAnimationFrame(still);
      };
      frame = requestAnimationFrame(still);
    } else {
      frame = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(frame);
      for (const flight of flights) {
        scene.remove(flight.sprite);
        (flight.sprite.material as SpriteMaterial).dispose();
      }
      texture.dispose();
    };
  }, [globeRef, arcs, color, ready, reducedMotion, altitudeAutoScale]);
}
