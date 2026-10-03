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
  adults?: number;
  cabin?: Cabin;
};

const CABINS: readonly Cabin[] = ["economy", "premium_economy", "business", "first"];
const MAX_ADULTS = 9;

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

export function validateFareSearch(search: Record<string, unknown>): FareSearchParams {
  return {
    origin: airportCode(search.origin),
    destination: airportCode(search.destination),
    depart: calendarDate(search.depart),
    adults: adultCount(search.adults),
    cabin: CABINS.find((cabin) => cabin === search.cabin),
  };
}
