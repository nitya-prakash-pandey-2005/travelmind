import { expect, test } from "vitest";
import { AIRPORTS } from "../../test/fixtures";
import { KM_PER_NMI, estimateFlightMinutes, greatCircleKm, midpoint } from "./geo";

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
