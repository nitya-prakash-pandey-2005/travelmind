const NUMBER = new Intl.NumberFormat("en-US");
// en-US month names: en-GB ICU data abbreviates September as "Sept".
const DAY_MONTH = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function formatNumber(value: number): string {
  return NUMBER.format(value);
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${String(rest).padStart(2, "0")}m` : `${rest}m`;
}

export function formatDate(iso: string): string {
  return DATE.format(new Date(iso));
}

/** Compact axis/tooltip date, e.g. "12 Sep". Accepts a date ("2026-09-12") or a full ISO timestamp; "—" if invalid. */
export function formatDayMonth(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = DAY_MONTH.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("day")} ${part("month")}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Feed-style age of a timestamp: "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", then "12 Sep". */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "—";
  const age = now.getTime() - then.getTime();
  if (age < MINUTE) return "just now";
  if (age < HOUR) return `${Math.floor(age / MINUTE)} min ago`;
  if (age < DAY) return `${Math.floor(age / HOUR)} h ago`;
  const days = Math.floor(age / DAY);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return formatDayMonth(iso);
}
