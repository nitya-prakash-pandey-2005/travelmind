import type { DailyFares, DaysOutBucket, DaysOutFares, RouteIntel } from "../../api/routeIntel";
import { formatWholeMoney } from "../pipeline/enquiryFacts";

/** Plain-language readings of a route's fare figures. Money is shown in whole units of the route currency. */

export const WINDOW_DAYS = 60;

const BUCKET_RANGE: Record<DaysOutBucket, string> = {
  "0-7": "0–7",
  "8-21": "8–21",
  "22-45": "22–45",
  "46-90": "46–90",
  "91+": "91+",
};

/** "22–45" for a days-out bucket. */
export function bucketRange(bucket: DaysOutBucket): string {
  return BUCKET_RANGE[bucket];
}

/** "22–45 days" for a days-out bucket. */
export function bucketLabel(bucket: DaysOutBucket): string {
  return `${BUCKET_RANGE[bucket]} days`;
}

export function money(minor: number, currency: string): string {
  return formatWholeMoney(minor, currency);
}

export function routeName(origin: string, destination: string): string {
  return `${origin} → ${destination}`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

export function latestDay(intel: RouteIntel): DailyFares | undefined {
  return intel.daily.at(-1);
}

/** The day with fares before the latest one, for the "median now" change. */
export function previousDay(intel: RouteIntel): DailyFares | undefined {
  return intel.daily.at(-2);
}

/** One local day on the trend: the day's median and middle half, or nulls for a day without fares. */
export type TrendDay = { date: string; median: number | null; low: number | null; high: number | null };

const DAY_MS = 86_400_000;

/**
 * Every local day from the first day with fares to the last, in order. `daily` lists only days with fares,
 * and the chart spaces points by position, so the missing days are added as gaps to keep the time axis true.
 */
export function calendarDays(daily: readonly DailyFares[]): TrendDay[] {
  const first = daily[0];
  const last = daily.at(-1);
  if (!first || !last) return [];
  const byDate = new Map(daily.map((day) => [day.date, day]));
  const days: TrendDay[] = [];
  const end = Date.parse(`${last.date}T00:00:00Z`);
  for (let at = Date.parse(`${first.date}T00:00:00Z`); at <= end; at += DAY_MS) {
    const date = new Date(at).toISOString().slice(0, 10);
    const fares = byDate.get(date);
    days.push(
      fares
        ? { date, median: fares.median_minor, low: fares.p25_minor, high: fares.p75_minor }
        : { date, median: null, low: null, high: null },
    );
  }
  return days;
}

export function totalSamples(intel: RouteIntel): number {
  return intel.daily.reduce((sum, day) => sum + day.samples, 0);
}

/** The days-out bucket with the lowest median (the earlier bucket on a tie). */
export function cheapestBucket(intel: RouteIntel): DaysOutFares | undefined {
  return intel.by_days_out.reduce<DaysOutFares | undefined>(
    (best, bucket) => (best === undefined || bucket.median_minor < best.median_minor ? bucket : best),
    undefined,
  );
}

/** Relative change in percent from `before` to `after`; null without a usable base. */
export function changePct(after: number, before: number | undefined): number | null {
  if (before === undefined || before <= 0) return null;
  return ((after - before) / before) * 100;
}

const stamps = new Map<string, Intl.DateTimeFormat>();

/** "3 Oct, 14:00" in the agency's time zone; the raw value if the zone is unknown. */
export function agencyStamp(iso: string, timeZone: string): string {
  let format = stamps.get(timeZone);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
    } catch {
      return iso;
    }
    stamps.set(timeZone, format);
  }
  return format.format(new Date(iso));
}
