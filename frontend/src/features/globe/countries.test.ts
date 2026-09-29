import type { MultiPolygon, Polygon, Position } from "geojson";
import { expect, test } from "vitest";
import { COUNTRIES } from "./countries";

const polygonsOf = (geometry: Polygon | MultiPolygon): Position[][][] =>
  geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
const distinctPoints = (ring: Position[]) => new Set(ring.map((p) => p.join(","))).size;

test("every country polygon has a real outline (h3 throws on zero-area rings and blanks the globe)", () => {
  expect(COUNTRIES.length).toBeGreaterThan(170);
  for (const country of COUNTRIES) {
    for (const polygon of polygonsOf(country.geometry)) {
      expect(distinctPoints(polygon[0] ?? []), String(country.properties?.name)).toBeGreaterThanOrEqual(3);
    }
  }
});

test("a country keeps its real outline when a zero-area sliver is dropped", () => {
  const northKorea = COUNTRIES.find((c) => c.properties?.name === "North Korea");
  expect(northKorea).toBeDefined();
  expect(polygonsOf(northKorea!.geometry)).toHaveLength(1);
});
