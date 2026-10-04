import { expect, test } from "vitest";
import { validateFareSearch } from "./fareSearchParams";

test("a full trip is kept, airport codes upper-cased", () => {
  expect(
    validateFareSearch({
      origin: "del",
      destination: "BOM",
      depart: "2026-11-20",
      return: "2026-11-27",
      adults: "2",
      children: [4, 11],
      cabin: "business",
    }),
  ).toEqual({
    origin: "DEL",
    destination: "BOM",
    depart: "2026-11-20",
    return: "2026-11-27",
    adults: 2,
    children: [4, 11],
    cabin: "business",
  });
});

test("children may also be typed as a comma-separated list", () => {
  expect(validateFareSearch({ children: "4, 0,17" }).children).toEqual([4, 0, 17]);
  expect(validateFareSearch({ children: 6 }).children).toEqual([6]);
});

test.each([
  ["an age over 17", [4, 18]],
  ["a fractional age", [2.5]],
  ["a negative age", [-1]],
  ["words", "two"],
  ["an empty list", []],
  ["more than eight children", [1, 2, 3, 4, 5, 6, 7, 8, 9]],
])("children with %s are ignored", (_, children) => {
  expect(validateFareSearch({ children }).children).toBeUndefined();
});

test("children that would take the party over nine travellers are ignored", () => {
  expect(validateFareSearch({ adults: 6, children: [3, 5, 7, 9] }).children).toBeUndefined();
  expect(validateFareSearch({ adults: 6, children: [3, 5, 7] }).children).toEqual([3, 5, 7]);
  // Without adults the form starts at one, so up to eight children fit.
  expect(validateFareSearch({ children: [1, 2, 3, 4, 5, 6, 7, 8] }).children).toHaveLength(8);
});

test.each([
  ["not a date", { depart: "2026-11-20", return: "next week" }],
  ["an impossible date", { depart: "2026-11-20", return: "2026-11-31" }],
  ["before departure", { depart: "2026-11-20", return: "2026-11-19" }],
  ["without a departure", { return: "2026-11-27" }],
])("a return date %s is ignored", (_, search) => {
  expect(validateFareSearch(search).return).toBeUndefined();
});

test("a same-day return is kept", () => {
  expect(validateFareSearch({ depart: "2026-11-20", return: "2026-11-20" }).return).toBe("2026-11-20");
});
