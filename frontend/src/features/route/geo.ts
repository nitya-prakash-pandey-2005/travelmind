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
