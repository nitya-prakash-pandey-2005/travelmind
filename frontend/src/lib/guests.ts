/** A whole number of guests from 1 to `max`; an empty or unreadable entry means one. */
export function clampGuests(draft: string, max: number): number {
  const value = Math.trunc(Number(draft));
  return Number.isFinite(value) && value >= 1 ? Math.min(max, value) : 1;
}
