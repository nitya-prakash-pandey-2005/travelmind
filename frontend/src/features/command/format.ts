import type { Kpi } from "../../api/dashboard";
import { formatDuration, formatNumber } from "../../lib/format";
import { formatMoneyCompact } from "../../lib/money";
import type { KpiDelta } from "../../ui/charts";

const PERCENT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const DASH = "—";

const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

/** A KPI value as shown on its tile: "1,284", "58.3%", "₹6.2L", "43m", "1,240" + "kg"; "—" when missing. */
export function formatKpiValue(kpi: Kpi, currency: string): { value: string; unit?: string } {
  const value = kpi.value;
  if (!finite(value)) return { value: DASH };
  switch (kpi.unit) {
    case "percent":
      return { value: `${PERCENT.format(value)}%` };
    case "money":
      return { value: formatMoneyCompact({ amount_minor: value, currency }) };
    case "minutes":
      return { value: formatDuration(Math.round(value)) };
    case "kg":
      return { value: formatNumber(Math.round(value)), unit: "kg" };
    default:
      return { value: formatNumber(value) };
  }
}

/** Metrics where a fall is the good direction. */
const LOWER_IS_BETTER = new Set<Kpi["key"]>(["response_time"]);

/**
 * Change against the previous period, (value − previous) / previous, in percent; for a rate (unit
 * "percent") the difference in percentage points instead (`points`). Undefined when either period has
 * no figure; `pct` null when the previous period was zero (no base to compare with), except for rates.
 */
export function kpiDelta(kpi: Kpi): KpiDelta | undefined {
  const { value, previous } = kpi;
  if (!finite(value) || !finite(previous)) return undefined;
  const direction = value > previous ? "up" : value < previous ? "down" : "flat";
  const good = direction === "flat" || (direction === "down") === LOWER_IS_BETTER.has(kpi.key);
  if (kpi.unit === "percent") return { pct: value - previous, direction, good, points: true };
  if (previous === 0) return { pct: value === 0 ? 0 : null, direction, good };
  return { pct: ((value - previous) * 100) / previous, direction, good };
}

/** Daily values for a KPI's trend. Response time reports 0 for "no send that day": that's a gap, not 0 min. */
export function kpiSeries(kpi: Kpi): (number | null)[] {
  const gapsAtZero = kpi.key === "response_time";
  return kpi.series.map(({ value }) => (!finite(value) || (gapsAtZero && value === 0) ? null : value));
}

function hourIn(now: Date, timeZone: string): number {
  try {
    const hour = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now);
    const parsed = Number(hour);
    return Number.isFinite(parsed) ? parsed : now.getHours();
  } catch {
    return now.getHours();
  }
}

/** "Good morning" (05–11), "Good afternoon" (12–16) or "Good evening", on the agency's clock. */
export function greetingFor(now: Date, timeZone: string): string {
  const hour = hourIn(now, timeZone);
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

/** The calendar day at `now` in the agency's timezone, as YYYY-MM-DD. */
export function localDateIn(now: Date, timeZone: string): string {
  try {
    // en-CA formats dates as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Whole days from `today` to `date` (both YYYY-MM-DD). */
export function daysUntil(date: string, today: string): number {
  const day = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  const days = Math.round((day(date) - day(today)) / 86_400_000);
  return Number.isFinite(days) ? days : 0;
}

/** "▲ 8.2%", "▼ 10.9%", "0%". */
export function formatChange(pct: number): string {
  if (!finite(pct)) return DASH;
  if (pct === 0) return "0%";
  return `${pct > 0 ? "▲" : "▼"} ${PERCENT.format(Math.abs(pct))}%`;
}

/** "DEL → BOM"; a missing end reads "—". */
export function routeLabel(origin: string | null, destination: string | null): string {
  if (!origin && !destination) return DASH;
  return `${origin ?? DASH} → ${destination ?? DASH}`;
}
