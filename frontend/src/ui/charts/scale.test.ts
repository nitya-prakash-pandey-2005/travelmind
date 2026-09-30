import { expect, test } from "vitest";
import { areaPath, linearScale, niceMax, niceTicks, pathFromPoints, pickTickIndices } from "./scale";

test("scales", () => {
  expect(linearScale([0, 10], [0, 100])(5)).toBe(50);
  expect(linearScale([3, 3], [0, 100])(3)).toBe(50);
  expect([niceMax(0.7), niceMax(7), niceMax(23), niceMax(180)]).toEqual([1, 10, 25, 200]);
  expect(pathFromPoints([[0, 1], [2, 3]])).toBe("M0 1L2 3");
});

test("linear scale inverts ranges and never yields NaN", () => {
  expect(linearScale([0, 4], [100, 0])(1)).toBe(75);
  expect(linearScale([0, 0], [10, 30])(0)).toBe(20);
  expect(Number.isNaN(linearScale([5, 5], [0, 1])(99))).toBe(false);
});

test("niceMax snaps to 1, 2, 2.5 and 5 steps and has a floor for empty or flat data", () => {
  expect([niceMax(1), niceMax(2), niceMax(2.4), niceMax(4), niceMax(5), niceMax(51)]).toEqual([1, 2, 2.5, 5, 5, 100]);
  expect([niceMax(0), niceMax(-3), niceMax(Number.NaN)]).toEqual([1, 1, 1]);
  expect(niceMax(0.07)).toBe(0.1);
});

test("niceTicks divides a nice max into clean steps", () => {
  expect(niceTicks(25)).toEqual([0, 5, 10, 15, 20, 25]);
  expect(niceTicks(200)).toEqual([0, 50, 100, 150, 200]);
  expect(niceTicks(10)).toEqual([0, 5, 10]);
  expect(niceTicks(5)).toEqual([0, 1, 2, 3, 4, 5]);
});

test("paths round coordinates and close areas on the baseline", () => {
  expect(pathFromPoints([])).toBe("");
  expect(pathFromPoints([[0.123, 1.456]])).toBe("M0.12 1.46");
  expect(areaPath([[0, 1], [2, 3]], 10)).toBe("M0 10L0 1L2 3L2 10Z");
  expect(areaPath([], 10)).toBe("");
});

test("tick indices are evenly spread, include both ends and respect the cap", () => {
  expect(pickTickIndices(3, 6)).toEqual([0, 1, 2]);
  expect(pickTickIndices(30, 6)).toEqual([0, 6, 12, 17, 23, 29]);
  expect(pickTickIndices(1, 6)).toEqual([0]);
  expect(pickTickIndices(0, 6)).toEqual([]);
});
