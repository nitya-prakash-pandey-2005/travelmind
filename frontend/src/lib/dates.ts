const pad = (value: number) => String(value).padStart(2, "0");

/** A local calendar date `days` from now as YYYY-MM-DD (the value format of <input type="date">). */
export function isoDateFromNow(days: number, now: Date = new Date()): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "2026-11-20T06:10:00" → "06:10". Supplier times are airport-local, so they are shown as given. */
export function localTime(iso: string): string {
  return iso.slice(11, 16);
}

/** Calendar days between two airport-local timestamps (the "+1" on an overnight arrival). */
export function dayShift(departing: string, arriving: string): number {
  const day = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.round((day(arriving) - day(departing)) / 86_400_000);
}
