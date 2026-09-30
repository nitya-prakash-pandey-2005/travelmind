import { expect, test } from "vitest";
import { AIRPORTS } from "../../test/fixtures";
import { KM_PER_NMI, estimateFlightMinutes, greatCircleKm, greatCirclePoints, midpoint } from "./geo";

test("Delhi to Mumbai is about 1,138 km", () => {
  const km = greatCircleKm(AIRPORTS.DEL, AIRPORTS.BOM);
  expect(Math.round(km)).toBe(1138);
  expect(Math.round(km / KM_PER_NMI)).toBe(615);
  expect(estimateFlightMinutes(km)).toBe(118);
});

test("London to New York is about 5,540 km", () => {
  const km = greatCircleKm(AIRPORTS.LHR, AIRPORTS.JFK);
  expect(Math.round(km)).toBe(5540);
  expect(estimateFlightMinutes(km)).toBe(456);
});

test("distance is symmetric and zero for the same point", () => {
  expect(greatCircleKm(AIRPORTS.DEL, AIRPORTS.BOM)).toBeCloseTo(greatCircleKm(AIRPORTS.BOM, AIRPORTS.DEL), 9);
  expect(greatCircleKm(AIRPORTS.DEL, AIRPORTS.DEL)).toBe(0);
});

test("midpoint lies halfway along the great circle", () => {
  const mid = midpoint({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 90 });
  expect(mid.lat).toBeCloseTo(0, 6);
  expect(mid.lng).toBeCloseTo(45, 6);
});

test("great-circle points run from one end to the other through the midpoint", () => {
  const points = greatCirclePoints(AIRPORTS.LHR, AIRPORTS.JFK, 10);
  expect(points).toHaveLength(11);
  expect(points[0]?.lat).toBeCloseTo(AIRPORTS.LHR.latitude, 6);
  expect(points[0]?.lng).toBeCloseTo(AIRPORTS.LHR.longitude, 6);
  expect(points[10]?.lat).toBeCloseTo(AIRPORTS.JFK.latitude, 6);
  expect(points[10]?.lng).toBeCloseTo(AIRPORTS.JFK.longitude, 6);
  const mid = midpoint(AIRPORTS.LHR, AIRPORTS.JFK);
  expect(points[5]?.lat).toBeCloseTo(mid.lat, 6);
  expect(points[5]?.lng).toBeCloseTo(mid.lng, 6);
  // The great circle bows north of both ends on the way across the Atlantic.
  expect(Math.max(...points.map((p) => p.lat))).toBeGreaterThan(AIRPORTS.LHR.latitude);
});

test("great-circle points for one airport stay on it, never NaN", () => {
  const points = greatCirclePoints(AIRPORTS.DEL, AIRPORTS.DEL, 4);
  expect(points).toHaveLength(5);
  for (const p of points) {
    expect(p.lat).toBeCloseTo(AIRPORTS.DEL.latitude, 6);
    expect(p.lng).toBeCloseTo(AIRPORTS.DEL.longitude, 6);
  }
});
