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

/** Compact axis/tooltip date, e.g. "12 Sep". Accepts a date ("2026-09-12") or a full ISO timestamp. */
export function formatDayMonth(iso: string): string {
  const parts = DAY_MONTH.formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("day")} ${part("month")}`;
}
