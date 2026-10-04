import { describe, expect, it } from "vitest";
import type { Airport } from "../../api/types";
import { greatCircleAngle, interpolateGreatCircle, MAX_PLANES, planeArcs } from "./flyingPlanes";
import type { GlobeArc } from "./RouteGlobe";
import { routeAltitude } from "./useFlyToActiveRoute";

const airport = (iata_code: string, latitude: number, longitude: number) => ({ iata_code, latitude, longitude }) as Airport;
const DEL = airport("DEL", 28.5665, 77.1031);
const DXB = airport("DXB", 25.2532, 55.3657);
const BOM = airport("BOM", 19.0896, 72.8656);
const LHR = airport("LHR", 51.47, -0.4543);

describe("great-circle maths", () => {
  it("measures DEL to DXB as about 2,190 km of arc", () => {
    const km = greatCircleAngle([DEL.longitude, DEL.latitude], [DXB.longitude, DXB.latitude]) * 6371;
    expect(km).toBeGreaterThan(2100);
    expect(km).toBeLessThan(2250);
  });

  it("starts and ends at the airports and stays between them", () => {
    const a: [number, number] = [DEL.longitude, DEL.latitude];
    const b: [number, number] = [DXB.longitude, DXB.latitude];
    const [lng0, lat0] = interpolateGreatCircle(a, b, 0);
    const [lng1, lat1] = interpolateGreatCircle(a, b, 1);
    expect(lng0).toBeCloseTo(DEL.longitude, 6);
    expect(lat0).toBeCloseTo(DEL.latitude, 6);
    expect(lng1).toBeCloseTo(DXB.longitude, 6);
    expect(lat1).toBeCloseTo(DXB.latitude, 6);
    const [lngMid] = interpolateGreatCircle(a, b, 0.5);
    expect(lngMid).toBeGreaterThan(DXB.longitude);
    expect(lngMid).toBeLessThan(DEL.longitude);
  });
});

describe("planeArcs", () => {
  const arc = (from: Airport, to: Airport, active: boolean): GlobeArc => ({ from, to, active });

  it("flies only the highlighted routes when there are any", () => {
    const arcs = [arc(DEL, DXB, false), arc(DEL, BOM, true)];
    expect(planeArcs(arcs)).toEqual([arcs[1]]);
  });

  it("falls back to the first routes, capped, when none is highlighted", () => {
    const arcs = Array.from({ length: 7 }, () => arc(DEL, BOM, false));
    expect(planeArcs(arcs)).toHaveLength(MAX_PLANES);
  });
});

describe("routeAltitude", () => {
  it("frames a short hop closer than a long-haul route", () => {
    expect(routeAltitude(DEL, BOM)).toBeLessThan(routeAltitude(DEL, LHR));
  });

  it("keeps a compact map at least as close as the full map", () => {
    expect(routeAltitude(DEL, DXB, true)).toBeLessThanOrEqual(routeAltitude(DEL, DXB));
  });
});
