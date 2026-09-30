import { expect, test } from "vitest";
import type { Kpi } from "../../api/dashboard";
import { daysUntil, formatChange, formatKpiValue, greetingFor, kpiDelta, kpiSeries, localDateIn, routeLabel } from "./format";

function kpi(overrides: Partial<Kpi>): Kpi {
  return { key: "open_enquiries", label: "Open enquiries", unit: "count", value: 0, previous: 0, series: [], ...overrides };
}

test("KPI values are formatted by unit", () => {
  expect(formatKpiValue(kpi({ unit: "count", value: 1284 }), "INR")).toEqual({ value: "1,284" });
  expect(formatKpiValue(kpi({ key: "win_rate", unit: "percent", value: 58.3 }), "INR")).toEqual({ value: "58.3%" });
  expect(formatKpiValue(kpi({ key: "win_rate", unit: "percent", value: 12.5 }), "INR")).toEqual({ value: "12.5%" });
  expect(formatKpiValue(kpi({ key: "win_rate", unit: "percent", value: 50 }), "INR")).toEqual({ value: "50%" });
  expect(formatKpiValue(kpi({ key: "pipeline_value", unit: "money", value: 62_000_000 }), "INR")).toEqual({ value: "₹6.2L" });
  expect(formatKpiValue(kpi({ key: "pipeline_value", unit: "money", value: 1_240_000 }), "USD")).toEqual({ value: "$12.4K" });
  expect(formatKpiValue(kpi({ key: "response_time", unit: "minutes", value: 42.5 }), "INR")).toEqual({ value: "43m" });
  expect(formatKpiValue(kpi({ key: "response_time", unit: "minutes", value: 135 }), "INR")).toEqual({ value: "2h 15m" });
  expect(formatKpiValue(kpi({ key: "co2_quoted", unit: "kg", value: 1240 }), "INR")).toEqual({ value: "1,240", unit: "kg" });
});

test("a missing KPI value reads as a dash, never NaN", () => {
  for (const unit of ["count", "percent", "money", "minutes", "kg"] as const) {
    expect(formatKpiValue(kpi({ unit, value: null }), "INR")).toEqual({ value: "—" });
  }
  expect(formatKpiValue(kpi({ unit: "count", value: Number.NaN }), "INR")).toEqual({ value: "—" });
});

test("the delta compares with the previous period; lower response time is good", () => {
  expect(kpiDelta(kpi({ value: 12, previous: 10 }))).toEqual({ pct: 20, direction: "up", good: true });
  expect(kpiDelta(kpi({ value: 8, previous: 10 }))).toEqual({ pct: -20, direction: "down", good: false });
  expect(kpiDelta(kpi({ key: "response_time", unit: "minutes", value: 42.5, previous: 55 }))).toMatchObject({
    direction: "down",
    good: true,
  });
  expect(kpiDelta(kpi({ key: "response_time", unit: "minutes", value: 60, previous: 55 }))).toMatchObject({
    direction: "up",
    good: false,
  });
  expect(kpiDelta(kpi({ value: 5, previous: 5 }))).toEqual({ pct: 0, direction: "flat", good: true });
});

test("no delta without two comparable periods", () => {
  expect(kpiDelta(kpi({ value: 0, previous: 0 }))).toEqual({ pct: 0, direction: "flat", good: true });
  expect(kpiDelta(kpi({ value: 3, previous: 0 }))).toEqual({ pct: null, direction: "up", good: true });
  expect(kpiDelta(kpi({ key: "pipeline_value", unit: "money", value: 100, previous: null }))).toBeUndefined();
  expect(kpiDelta(kpi({ key: "win_rate", unit: "percent", value: null, previous: 50 }))).toBeUndefined();
});

test("response time days without a first send are gaps, not zero minutes", () => {
  const series = [
    { date: "2026-09-28", value: 30 },
    { date: "2026-09-29", value: 0 },
    { date: "2026-09-30", value: 45 },
  ];
  expect(kpiSeries(kpi({ key: "response_time", unit: "minutes", series }))).toEqual([30, null, 45]);
  expect(kpiSeries(kpi({ key: "searches", series }))).toEqual([30, 0, 45]);
});

test("the greeting follows the agency's clock", () => {
  expect(greetingFor(new Date("2026-09-30T03:00:00Z"), "Asia/Kolkata")).toBe("Good morning"); // 08:30
  expect(greetingFor(new Date("2026-09-30T09:00:00Z"), "Asia/Kolkata")).toBe("Good afternoon"); // 14:30
  expect(greetingFor(new Date("2026-09-30T13:00:00Z"), "Asia/Kolkata")).toBe("Good evening"); // 18:30
  expect(greetingFor(new Date("2026-09-30T13:00:00Z"), "Europe/London")).toBe("Good afternoon"); // 14:00
  expect(greetingFor(new Date("2026-09-30T13:00:00Z"), "Not/AZone")).toMatch(/^Good /);
});

test("local dates and days until a departure", () => {
  expect(localDateIn(new Date("2026-09-30T20:00:00Z"), "Asia/Kolkata")).toBe("2026-10-01");
  expect(localDateIn(new Date("2026-09-30T20:00:00Z"), "Europe/London")).toBe("2026-09-30");
  expect(daysUntil("2026-10-01", "2026-10-01")).toBe(0);
  expect(daysUntil("2026-10-06", "2026-10-01")).toBe(5);
});

test("fare changes and routes read plainly", () => {
  expect(formatChange(-10.9)).toBe("▼ 10.9%");
  expect(formatChange(8.2)).toBe("▲ 8.2%");
  expect(formatChange(0)).toBe("0%");
  expect(routeLabel("DEL", "BOM")).toBe("DEL → BOM");
  expect(routeLabel("BOM", null)).toBe("BOM → —");
  expect(routeLabel(null, null)).toBe("—");
});
