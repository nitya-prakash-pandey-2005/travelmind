import { expect, test } from "vitest";
import { clampGuests } from "./guests";

test("clampGuests keeps whole numbers between one and the maximum", () => {
  expect(clampGuests("3", 9)).toBe(3);
  expect(clampGuests("12", 9)).toBe(9);
  expect(clampGuests("7", 6)).toBe(6);
  expect(clampGuests("2.8", 6)).toBe(2);
});

test("clampGuests reads an empty, zero, negative or unreadable entry as one guest", () => {
  for (const draft of ["", " ", "0", "-4", "abc", "Infinity"]) expect(clampGuests(draft, 9)).toBe(1);
});
