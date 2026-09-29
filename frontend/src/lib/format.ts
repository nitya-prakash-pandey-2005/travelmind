const NUMBER = new Intl.NumberFormat("en-US");
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
