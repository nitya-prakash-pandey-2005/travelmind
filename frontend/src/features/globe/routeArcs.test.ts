import { expect, test } from "vitest";
import { AIRPORTS } from "../../test/fixtures";
import { routeArcs, summariseRoutes } from "./routeArcs";

const airports = new Map(Object.values(AIRPORTS).map((a) => [a.iata_code, a]));
const label = (arcs: ReturnType<typeof routeArcs>) =>
  arcs.map((a) => `${a.from.iata_code}-${a.to.iata_code}${a.active ? "*" : ""}×${a.weight ?? 1}`);

test("routes are counted, busiest first, skipping incomplete and looping ones", () => {
  const routes = summariseRoutes([
    { origin: "BOM", destination: "GOI", status: "new" },
    { origin: "DEL", destination: "BOM", status: "quoted" },
    { origin: "DEL", destination: "BOM", status: "won" },
    { origin: "DEL", destination: null, status: "new" },
    { origin: "DEL", destination: "DEL", status: "new" },
  ]);
  expect(routes).toEqual([
    { origin: "DEL", destination: "BOM", count: 2, won: true },
    { origin: "BOM", destination: "GOI", count: 1, won: false },
  ]);
});

test("won routes are active and weighted; the plotted route leads", () => {
  const routes = summariseRoutes([
    { origin: "BOM", destination: "GOI", status: "new" },
    { origin: "BOM", destination: "GOI", status: "quoting" },
    { origin: "LHR", destination: "JFK", status: "won" },
    { origin: "DEL", destination: "BOM", status: "new" },
  ]);
  expect(label(routeArcs(routes, airports, { origin: null, destination: null }))).toEqual([
    "LHR-JFK*×1",
    "BOM-GOI×2",
    "DEL-BOM×1",
  ]);
  expect(label(routeArcs(routes, airports, { origin: AIRPORTS.DEL, destination: AIRPORTS.BOM }))).toEqual([
    "DEL-BOM*×1",
    "LHR-JFK*×1",
    "BOM-GOI×2",
  ]);
});

test("routes whose airports aren't known yet are left out", () => {
  const routes = summariseRoutes([{ origin: "DEL", destination: "XXX", status: "won" }]);
  expect(routeArcs(routes, airports, { origin: null, destination: null })).toEqual([]);
});
