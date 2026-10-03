import type { EnquiryOut, EnquiryStatus } from "../../api/enquiries";
import { ENQUIRY_TRANSITIONS } from "../../api/enquiries";
import type { QuoteSummary } from "../../api/quotes";
import { formatDayMonth } from "../../lib/format";
import { currencyExponent, formatMoney } from "../../lib/money";
import { STATUS_PILL } from "../../ui/StatusPill";

/** Board order: the stages an enquiry moves through, then the two ways it closes. */
export const STAGES: readonly EnquiryStatus[] = ["new", "quoting", "quoted", "won", "lost"];

export const stageLabel = (status: EnquiryStatus): string => STATUS_PILL[status].label;

export const canMove = (from: EnquiryStatus, to: EnquiryStatus): boolean => ENQUIRY_TRANSITIONS[from].includes(to);

/** "DEL → BOM", with a dash for an airport not set yet; "Route not set" when neither is. */
export function routeLabel(enquiry: Pick<EnquiryOut, "origin" | "destination">): string {
  if (!enquiry.origin && !enquiry.destination) return "Route not set";
  return `${enquiry.origin ?? "—"} → ${enquiry.destination ?? "—"}`;
}

/** The card's accessible name: "E-0007 DEL → BOM". */
export const enquiryName = (enquiry: Pick<EnquiryOut, "number" | "origin" | "destination">): string =>
  `${enquiry.number} ${routeLabel(enquiry)}`;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "2 adults · 1 child". */
export function travellersLabel(enquiry: Pick<EnquiryOut, "adults" | "children_ages">): string {
  const parts = [plural(enquiry.adults, "adult", "adults")];
  if (enquiry.children_ages.length > 0) parts.push(plural(enquiry.children_ages.length, "child", "children"));
  return parts.join(" · ");
}

export const travellerCount = (enquiry: Pick<EnquiryOut, "adults" | "children_ages">): number =>
  enquiry.adults + enquiry.children_ages.length;

/** "20 Nov – 27 Nov", "20 Nov · one way", or null without a departure date. */
export function tripDates(enquiry: Pick<EnquiryOut, "depart_date" | "return_date">): string | null {
  if (!enquiry.depart_date) return null;
  const depart = formatDayMonth(enquiry.depart_date);
  return enquiry.return_date ? `${depart} – ${formatDayMonth(enquiry.return_date)}` : `${depart} · one way`;
}

const CABIN_LABELS: Record<string, string> = {
  economy: "Economy",
  premium_economy: "Premium economy",
  business: "Business",
  first: "First",
};

export const cabinLabel = (cabin: string): string => CABIN_LABELS[cabin] ?? cabin;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Compact age for a card: "12 min", "5 h", "3 d", "6 w". */
export function ageLabel(iso: string, now: Date): string {
  const age = Math.max(0, now.getTime() - new Date(iso).getTime());
  if (Number.isNaN(age)) return "—";
  if (age < HOUR) return `${Math.max(1, Math.floor(age / MINUTE))} min`;
  if (age < DAY) return `${Math.floor(age / HOUR)} h`;
  const days = Math.floor(age / DAY);
  return days < 28 ? `${days} d` : `${Math.floor(days / 7)} w`;
}

/** The spoken form of ageLabel: "opened 3 days ago". */
export function ageDescription(iso: string, now: Date): string {
  const age = Math.max(0, now.getTime() - new Date(iso).getTime());
  if (age < HOUR) return "opened within the hour";
  if (age < DAY) return `opened ${plural(Math.floor(age / HOUR), "hour", "hours")} ago`;
  return `opened ${plural(Math.floor(age / DAY), "day", "days")} ago`;
}

/** Each enquiry's most recent quote (by creation), the one the board values it at. */
export function latestQuotes(quotes: readonly QuoteSummary[]): Map<string, QuoteSummary> {
  const latest = new Map<string, QuoteSummary>();
  for (const quote of quotes) {
    const seen = latest.get(quote.enquiry.id);
    if (!seen || quote.created_at > seen.created_at) latest.set(quote.enquiry.id, quote);
  }
  return latest;
}

/** The value an enquiry adds to its column: its latest quote's cheapest option, in the agency currency only. */
export function quotedValue(quote: QuoteSummary | undefined, currency: string): number {
  return quote && quote.currency === currency && quote.min_sell_minor !== null ? quote.min_sell_minor : 0;
}

/** A board figure in whole units: "₹2,16,804" rather than "₹2,16,804.38". */
export function formatWholeMoney(minor: number, currency: string): string {
  const scale = 10 ** currencyExponent(currency);
  return formatMoney({ amount_minor: Math.round(minor / scale) * scale, currency });
}
