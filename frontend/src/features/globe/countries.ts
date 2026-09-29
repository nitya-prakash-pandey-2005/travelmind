import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import countriesTopology from "world-atlas/countries-110m.json";

type CountryGeometry = Polygon | MultiPolygon;
export type Country = Feature<CountryGeometry, { name?: string }>;

const topology = countriesTopology as unknown as Topology<{ countries: GeometryCollection<{ name?: string }> }>;

/** A polygon needs at least three distinct outline points to enclose any area. */
function hasArea(polygon: Position[][]): boolean {
  return new Set((polygon[0] ?? []).map((p) => p.join(","))).size >= 3;
}

/**
 * The 110m atlas quantises some islets into zero-area rings (North Korea has one). h3 throws on those,
 * and the throw escapes three-globe's hex-polygon pass, so drop them before they reach the globe.
 */
function withoutZeroAreaRings(country: Country): Country | null {
  const { geometry } = country;
  if (geometry.type === "Polygon") return hasArea(geometry.coordinates) ? country : null;
  const coordinates = geometry.coordinates.filter(hasArea);
  if (coordinates.length === 0) return null;
  return { ...country, geometry: { ...geometry, coordinates } };
}

export const COUNTRIES: Country[] = (feature(topology, topology.objects.countries).features as Country[])
  .map(withoutZeroAreaRings)
  .filter((country): country is Country => country !== null);
