import { expect, test } from "vitest";
import { formatDate, formatDuration, formatNumber } from "./format";

test("formatNumber groups thousands", () => {
  expect(formatNumber(1138)).toBe("1,138");
  expect(formatNumber(615)).toBe("615");
});

test("formatDuration shows hours and zero-padded minutes", () => {
  expect(formatDuration(118)).toBe("1h 58m");
  expect(formatDuration(456)).toBe("7h 36m");
  expect(formatDuration(120)).toBe("2h 00m");
  expect(formatDuration(45)).toBe("45m");
});

test("formatDate is short and unambiguous", () => {
  expect(formatDate("2026-10-06T09:30:00Z")).toBe("6 Oct 2026");
});
