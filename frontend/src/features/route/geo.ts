export type GeoPoint = { latitude: number; longitude: number };

const EARTH_RADIUS_KM = 6371;
export const KM_PER_NMI = 1.852;
/** Assumptions behind the flight-time estimate; shown to users next to the number. */
export const CRUISE_KMH = 780;
export const TAXI_CLIMB_DESCENT_MIN = 30;

const toRad = (degrees: number) => (degrees * Math.PI) / 180;
const toDeg = (radians: number) => (radians * 180) / Math.PI;

/** Haversine great-circle distance in kilometres. */
export function greatCircleKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function estimateFlightMinutes(km: number): number {
  return Math.round((km / CRUISE_KMH) * 60 + TAXI_CLIMB_DESCENT_MIN);
}

/** Point halfway along the great circle between a and b. */
export function midpoint(a: GeoPoint, b: GeoPoint): { lat: number; lng: number } {
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const lng1 = toRad(a.longitude);
  const dLng = toRad(b.longitude - a.longitude);
  const bx = Math.cos(lat2) * Math.cos(dLng);
  const by = Math.cos(lat2) * Math.sin(dLng);
  const lat = Math.atan2(Math.sin(lat1) + Math.sin(lat2), Math.sqrt((Math.cos(lat1) + bx) ** 2 + by ** 2));
  const lng = lng1 + Math.atan2(by, Math.cos(lat1) + bx);
  return { lat: toDeg(lat), lng: ((toDeg(lng) + 540) % 360) - 180 };
}

/**
 * `segments + 1` points along the great circle from a to b (spherical interpolation), for drawing a route
 * on a flat map. Longitudes stay in −180…180; a caller splits the line where it crosses the antimeridian.
 */
export function greatCirclePoints(a: GeoPoint, b: GeoPoint, segments = 48): { lat: number; lng: number }[] {
  const toVector = (p: GeoPoint) => {
    const lat = toRad(p.latitude);
    const lng = toRad(p.longitude);
    return [Math.cos(lat) * Math.cos(lng), Math.cos(lat) * Math.sin(lng), Math.sin(lat)] as const;
  };
  const va = toVector(a);
  const vb = toVector(b);
  const dot = Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const omega = Math.acos(dot);
  const steps = Math.max(1, Math.round(segments));
  const points: { lat: number; lng: number }[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    // Coincident (or antipodal) ends have no single great circle: fall back to a straight blend.
    const [wa, wb] = omega < 1e-9 ? [1 - t, t] : [Math.sin((1 - t) * omega) / Math.sin(omega), Math.sin(t * omega) / Math.sin(omega)];
    const x = wa * va[0] + wb * vb[0];
    const y = wa * va[1] + wb * vb[1];
    const z = wa * va[2] + wb * vb[2];
    points.push({ lat: toDeg(Math.atan2(z, Math.hypot(x, y))), lng: toDeg(Math.atan2(y, x)) });
  }
  return points;
}
