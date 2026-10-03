import { expect, test } from "vitest";
import { validateRouteIntelSearch } from "./routeIntelParams";

test("airport codes and the cabin are read from the address, codes upper-cased", () => {
  expect(validateRouteIntelSearch({ origin: "del", destination: "BOM", cabin: "business" })).toEqual({
    origin: "DEL",
    destination: "BOM",
    cabin: "business",
  });
});

test("anything malformed is dropped on its own", () => {
  expect(validateRouteIntelSearch({ origin: "DELHI", destination: "B0M", cabin: "luxury" })).toEqual({
    origin: undefined,
    destination: undefined,
    cabin: undefined,
  });
  expect(validateRouteIntelSearch({ origin: 123, destination: ["BOM"], cabin: null })).toEqual({
    origin: undefined,
    destination: undefined,
    cabin: undefined,
  });
  expect(validateRouteIntelSearch({})).toEqual({ origin: undefined, destination: undefined, cabin: undefined });
});

test("the same airport twice keeps only the origin", () => {
  expect(validateRouteIntelSearch({ origin: "DEL", destination: "del" })).toEqual({
    origin: "DEL",
    destination: undefined,
    cabin: undefined,
  });
});
