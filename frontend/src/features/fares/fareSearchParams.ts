import type { Cabin } from "../../api/offers";

/**
 * A trip to prefill Fare search with, from the address (/app/fares?origin=DEL&destination=BOM&depart=…):
 * how an enquiry opens a search for its trip. Anything malformed is dropped, so a bad link only loses
 * that part of the prefill.
 */
export type FareSearchParams = {
  origin?: string;
  destination?: string;
  /** YYYY-MM-DD */
  depart?: string;
  /** YYYY-MM-DD, on or after `depart`; only kept with a departure date. */
  return?: string;
  adults?: number;
  /** Each child's age (0–17), as `[4,11]` or "4,11" in the address. */
  children?: number[];
  cabin?: Cabin;
};

const CABINS: readonly Cabin[] = ["economy", "premium_economy", "business", "first"];
/** A search's seats (the backend's MAX_PASSENGERS) and its child limit. */
export const MAX_PASSENGERS = 9;
const MAX_ADULTS = MAX_PASSENGERS;
const MAX_CHILDREN = 8;
const MAX_CHILD_AGE = 17;

function airportCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z]{3}$/.test(value) ? value.toUpperCase() : undefined;
}

function calendarDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}

function adultCount(value: unknown): number | undefined {
  const count = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(count) && count >= 1 && count <= MAX_ADULTS ? count : undefined;
}

function childAges(value: unknown): number[] | undefined {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "number"
      ? [value]
      : typeof value === "string" && value.trim() !== ""
        ? value.split(",").map((part) => (part.trim() === "" ? Number.NaN : Number(part)))
        : [];
  if (raw.length === 0 || raw.length > MAX_CHILDREN) return undefined;
  const ok = raw.every((age) => typeof age === "number" && Number.isInteger(age) && age >= 0 && age <= MAX_CHILD_AGE);
  return ok ? (raw as number[]) : undefined;
}

export function validateFareSearch(search: Record<string, unknown>): FareSearchParams {
  const depart = calendarDate(search.depart);
  const returning = calendarDate(search.return);
  const adults = adultCount(search.adults);
  const children = childAges(search.children);
  return {
    origin: airportCode(search.origin),
    destination: airportCode(search.destination),
    depart,
    return: depart && returning && returning >= depart ? returning : undefined,
    adults,
    // Children that would take the party past the seats a search allows are dropped, not the adults.
    children: children && (adults ?? 1) + children.length <= MAX_PASSENGERS ? children : undefined,
    cabin: CABINS.find((cabin) => cabin === search.cabin),
  };
}
