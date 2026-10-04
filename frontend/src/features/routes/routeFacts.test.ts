import { expect, test } from "vitest";
import type { DailyFares } from "../../api/routeIntel";
import { calendarDays } from "./routeFacts";

const day = (date: string, median: number): DailyFares => ({
  date,
  p25_minor: median - 100,
  median_minor: median,
  p75_minor: median + 100,
  samples: 3,
});

test("every local day between the first and last is listed, days without fares as gaps", () => {
  const days = calendarDays([day("2026-09-29", 500), day("2026-10-02", 600)]);
  expect(days.map((d) => d.date)).toEqual(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
  expect(days[0]).toEqual({ date: "2026-09-29", median: 500, low: 400, high: 600 });
  expect(days[1]).toEqual({ date: "2026-09-30", median: null, low: null, high: null });
  expect(days[2]).toEqual({ date: "2026-10-01", median: null, low: null, high: null });
  expect(days[3]?.median).toBe(600);
});

test("month ends, a single day and no days are handled", () => {
  expect(calendarDays([day("2026-02-27", 1), day("2026-03-02", 2)]).map((d) => d.date)).toEqual([
    "2026-02-27",
    "2026-02-28",
    "2026-03-01",
    "2026-03-02",
  ]);
  expect(calendarDays([day("2026-10-03", 5)])).toHaveLength(1);
  expect(calendarDays([])).toEqual([]);
});
