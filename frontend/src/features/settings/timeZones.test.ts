import { afterEach, expect, test, vi } from "vitest";
import { timeZoneOptions } from "./timeZones";

const NOW = new Date("2026-01-15T12:00:00Z");

afterEach(() => vi.restoreAllMocks());

test("common zones come labelled with their UTC offset, ordered west to east", () => {
  const options = timeZoneOptions("Asia/Kolkata", NOW);
  const kolkata = options.find((o) => o.value === "Asia/Kolkata");
  expect(kolkata?.label).toBe("(UTC+05:30) Asia/Kolkata");
  const london = options.find((o) => o.value === "Europe/London");
  expect(london?.label).toBe("(UTC+00:00) Europe/London");
  expect(options.find((o) => o.value === "America/New_York")?.label).toBe("(UTC−05:00) America/New_York");
  const offsets = options.map((o) => o.offsetMinutes);
  expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  expect(options.length).toBeGreaterThan(20);
  expect(options.length).toBeLessThan(80);
});

test("the agency's own zone is always offered, even when it isn't a common one", () => {
  const options = timeZoneOptions("Pacific/Chatham", NOW);
  expect(options.some((o) => o.value === "Pacific/Chatham")).toBe(true);
  expect(new Set(options.map((o) => o.value)).size).toBe(options.length);
});

test("zones the browser doesn't know are left out", () => {
  const options = timeZoneOptions("Mars/Olympus_Mons", NOW);
  expect(options.some((o) => o.value === "Mars/Olympus_Mons")).toBe(false);
  expect(options.some((o) => o.value === "UTC")).toBe(true);
});

test("without Intl.supportedValuesOf the common list still works", () => {
  vi.spyOn(Intl, "supportedValuesOf").mockImplementation(() => {
    throw new TypeError("not supported");
  });
  expect(timeZoneOptions("Asia/Kolkata", NOW).some((o) => o.value === "Asia/Kolkata")).toBe(true);
});
