import { MAX_AGENT_TEXT, type AgentRunStatus, type AgentTrip, type PlanResult } from "../../api/agent";
import type { Cabin } from "../../api/offers";
import type { EnquiryOut } from "../../api/enquiries";
import { POPULAR_AIRPORTS } from "../fares/popularRoutes";
import type { FareSearchParams } from "../fares/fareSearchParams";

/** Plain-words helpers for the Agent page: labels, prompts and the trip as text. */

/** /app/agent?prompt=…: a request to prefill, trimmed to the limit; anything else is dropped. */
export function validateAgentSearch(search: Record<string, unknown>): { prompt?: string } {
  const prompt = typeof search.prompt === "string" ? search.prompt.trim().slice(0, MAX_AGENT_TEXT) : "";
  return { prompt: prompt || undefined };
}

export const RUN_STATUS: Record<AgentRunStatus, { label: string; tone: "info" | "primary" | "warn" | "ok" | "danger" | "neutral" }> = {
  queued: { label: "Queued", tone: "info" },
  running: { label: "Planning", tone: "primary" },
  waiting_for_user: { label: "Needs input", tone: "warn" },
  done: { label: "Done", tone: "ok" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  budget_exceeded: { label: "Budget used", tone: "warn" },
};

const CABIN_WORDS: Record<Cabin, string> = {
  economy: "economy",
  premium_economy: "premium economy",
  business: "business class",
  first: "first class",
};

export const CABIN_LABEL: Record<Cabin, string> = {
  economy: "Economy",
  premium_economy: "Premium economy",
  business: "Business",
  first: "First",
};

/** The words a question's `fields` stand for ("depart_date" → "Departure date"). */
const FIELD_LABEL: Record<string, string> = {
  origin: "Leaving from",
  destination: "Going to",
  depart_date: "Departure date",
  return_date: "Return date",
  dates: "Dates",
  adults: "Adults",
  children: "Children",
  children_ages: "Children's ages",
  cabin: "Cabin",
  check_in: "Check-in",
  check_out: "Check-out",
  rooms: "Rooms",
  budget: "Budget",
};

export function fieldLabel(field: string): string {
  const known = FIELD_LABEL[field];
  if (known) return known;
  const words = field.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function travellersText(adults: number, children: readonly number[] = []): string {
  const parts = [plural(adults, "adult", "adults")];
  if (children.length > 0) parts.push(`${plural(children.length, "child", "children")} (${children.length === 1 ? "age" : "ages"} ${children.join(", ")})`);
  return parts.join(" and ");
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" });

/** "2026-11-20" → "20 Nov 2026". */
export function longDate(iso: string): string {
  return DATE.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
}

/** "2026-11-20" → { weekday: "Fri", day: "20 Nov" }. */
export function shortDay(iso: string): { weekday: string; day: string } {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return { weekday: WEEKDAY.format(date), day: DAY_MONTH.format(date) };
}

/** A prompt for the trip an enquiry asks for, written the way an agent would type it. */
export function enquiryPrompt(enquiry: Pick<EnquiryOut, "origin" | "destination" | "depart_date" | "return_date" | "adults" | "children_ages" | "cabin">): string {
  const route =
    enquiry.origin && enquiry.destination
      ? `from ${enquiry.origin} to ${enquiry.destination}`
      : enquiry.destination
        ? `to ${enquiry.destination}`
        : enquiry.origin
          ? `from ${enquiry.origin}`
          : "";
  const parts = [["Plan a trip", route].filter(Boolean).join(" ")];
  if (enquiry.depart_date) {
    parts.push(enquiry.return_date ? `${longDate(enquiry.depart_date)} to ${longDate(enquiry.return_date)}` : `departing ${longDate(enquiry.depart_date)}, one way`);
  }
  parts.push(`for ${travellersText(enquiry.adults, enquiry.children_ages)}`);
  parts.push(CABIN_WORDS[enquiry.cabin]);
  return `${parts.join(", ")}.`;
}

/** "New Delhi (DEL) → Dubai (DXB)" or the codes alone. */
export function routeText(trip: AgentTrip): string | null {
  const place = (code: string | undefined, city: string | null | undefined) => (code ? (city ? `${city} (${code})` : code) : null);
  const from = place(trip.origin, trip.origin_city);
  const to = place(trip.destination, trip.destination_city);
  if (from && to) return `${from} → ${to}`;
  return to;
}

/** The trip in one line, for a follow-up request: "DEL to DXB, 20 Nov 2026 to 24 Nov 2026, 2 adults, economy". */
export function tripLine(trip: AgentTrip): string {
  const parts: string[] = [];
  parts.push(trip.origin ? `${trip.origin} to ${trip.destination}` : `a stay near ${trip.destination}`);
  const start = trip.depart_date ?? trip.check_in;
  const end = trip.depart_date ? trip.return_date : trip.check_out;
  if (start) parts.push(end ? `${longDate(start)} to ${longDate(end)}` : longDate(start));
  parts.push(travellersText(trip.adults, trip.children_ages ?? []));
  if (trip.cabin) parts.push(CABIN_WORDS[trip.cabin]);
  return parts.join(", ");
}

/** Fare search's address for the plan's trip. */
export function fareSearchFor(trip: AgentTrip): FareSearchParams | null {
  if (!trip.origin) return null;
  return {
    origin: trip.origin,
    destination: trip.destination,
    ...(trip.depart_date ? { depart: trip.depart_date } : {}),
    ...(trip.depart_date && trip.return_date ? { return: trip.return_date } : {}),
    adults: trip.adults,
    ...(trip.children_ages && trip.children_ages.length > 0 ? { children: trip.children_ages } : {}),
    ...(trip.cabin ? { cabin: trip.cabin } : {}),
  };
}

/** Nights between the trip's two dates, when it has both. */
export function tripNights(trip: AgentTrip): number | null {
  if (typeof trip.nights === "number") return trip.nights;
  if (!trip.depart_date || !trip.return_date) return null;
  const days = (Date.parse(`${trip.return_date}T00:00:00Z`) - Date.parse(`${trip.depart_date}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(days) && days >= 0 ? days : null;
}

/** "412 ms", "1.4 s", "2 min 05 s". */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;
}

/** "≈ ₹8,331" → { approx: true, amount: "₹8,331" }, so the "≈" can be set apart. */
export function splitApprox(formatted: string): { approx: boolean; amount: string } {
  return formatted.startsWith("≈") ? { approx: true, amount: formatted.replace(/^≈\s*/, "") } : { approx: false, amount: formatted };
}

/** The first line of a prompt, cut at `max` characters. */
export function excerpt(text: string, max = 90): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** True when every price on the board passed the guard (no fallback). */
export function isVerified(grounded: boolean | null, result: PlanResult | null): boolean {
  return grounded === true && result !== null && !result.fallback;
}

const cityOf = (code: string) => (POPULAR_AIRPORTS as Record<string, { city: string | null }>)[code]?.city ?? code;

/** "20 Nov" for the day `days` from `now` (agency-agnostic: the planner reads the day and month). */
function dayFromNow(now: Date, days: number): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
  return DAY_MONTH.format(date);
}

export type Suggestion = { label: string; prompt: string };

/**
 * Ready-to-send prompts: the agency's own routes when it has some, otherwise busy routes, each a month out
 * for four nights so the dates are always in the future.
 */
export function suggestedPrompts(routes: readonly { origin: string; destination: string }[], now: Date = new Date()): Suggestion[] {
  const depart = dayFromNow(now, 30);
  const back = dayFromNow(now, 34);
  if (routes.length > 0) {
    return routes.slice(0, 4).map(({ origin, destination }, index) => {
      const party = index % 2 === 0 ? "2 adults" : "4 adults";
      const stay = index % 2 === 0 ? "economy" : "economy, with a hotel";
      // City names when both are known, else both codes (the planner reads codes in capitals as they are).
      const from = cityOf(origin);
      const to = cityOf(destination);
      const route = from !== origin && to !== destination ? `${from} to ${to}` : `${origin} to ${destination}`;
      return { label: `${origin} → ${destination}`, prompt: `${route} for ${party}, ${depart} to ${back}, ${stay}` };
    });
  }
  return [
    { label: "DEL → DXB", prompt: `Delhi to Dubai for 2 adults, ${depart} to ${back}, economy` },
    { label: "BOM → GOI", prompt: `Mumbai to Goa for 4 adults, ${depart} to ${back}, with a mid-range hotel` },
    { label: "BLR → SIN", prompt: `Bengaluru to Singapore for 2 adults and 1 child aged 8, ${depart} to ${back}, economy` },
    { label: "DEL → LHR", prompt: `Delhi to London for 2 adults, ${depart} to ${back}, premium economy` },
  ];
}
