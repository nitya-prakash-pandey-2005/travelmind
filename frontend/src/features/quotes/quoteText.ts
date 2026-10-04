import type { Slice } from "../../api/offers";
import type { QuoteClientRef, QuoteOption } from "../../api/quotes";
import { dayShift, localTime } from "../../lib/dates";
import { formatMoney } from "../../lib/money";

/**
 * The plain-text quote an agent pastes into WhatsApp, SMS or email: a greeting, one line per option
 * with the server's sell price, the link and its expiry. Prices come from the saved version only.
 */

export type QuoteMessageInput = {
  /** A person is greeted by first name; a company, like a quote without a client, with "Hello,". */
  client: Pick<QuoteClientRef, "name" | "kind"> | null;
  /** The options of the version being sent, in order. */
  options: QuoteOption[];
  /** When the link stops working (ISO); null leaves the expiry out. */
  expiresAt: string | null;
  link: string;
  agencyName?: string | null;
  /** IANA time zone for the expiry date (the agency's); UTC by default. */
  timeZone?: string;
};

/** "Priya" from "Priya Sharma"; null for a blank or missing name. */
export function firstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

/** "DEL 06:10 → BOM 08:20", "+1" on a next-day arrival, "(1 stop)" when it connects. */
export function journeyLine(slice: Slice): string {
  const first = slice.segments[0];
  const last = slice.segments[slice.segments.length - 1];
  if (!first || !last) return `${slice.origin} → ${slice.destination}`;
  const shift = dayShift(first.departing_at, last.arriving_at);
  const stops = slice.segments.length - 1;
  return [
    `${slice.origin} ${localTime(first.departing_at)} → ${slice.destination} ${localTime(last.arriving_at)}`,
    shift > 0 ? ` +${shift}` : "",
    stops > 0 ? ` (${stops} stop${stops > 1 ? "s" : ""})` : "",
  ].join("");
}

/** "Option 1 · IndiGo · DEL 06:10 → BOM 08:20 · ₹5,760" (and "for 2 travellers" on a party's total). */
export function optionLine(option: QuoteOption, index: number): string {
  const { offer, sell } = option;
  const travellers = offer.passenger_count > 1 ? ` for ${offer.passenger_count} travellers` : "";
  return [
    `Option ${index + 1}`,
    offer.owner_name ?? offer.owner_carrier,
    ...offer.slices.map(journeyLine),
    `${formatMoney(sell)}${travellers}`,
  ].join(" · ");
}

function expiryDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone }).format(new Date(iso));
}

/**
 * The first name to greet the client by: none for a company (as on the client's quote page, which the
 * server greets the same way) or without a client.
 */
export function greetingName(client: Pick<QuoteClientRef, "name" | "kind"> | null): string | null {
  return client && client.kind === "individual" ? firstName(client.name) : null;
}

export function composeQuoteMessage({ client, options, expiresAt, link, agencyName, timeZone = "UTC" }: QuoteMessageInput): string {
  const name = greetingName(client);
  const route = options[0]?.offer.slices[0];
  const several = options.length > 1;
  const subject = several ? "Here are your flight options" : "Here is your flight option";
  const valid = expiresAt ? ` (valid until ${expiryDate(expiresAt, timeZone)})` : "";
  const lines = [
    name ? `Hello ${name},` : "Hello,",
    "",
    route ? `${subject} for ${route.origin} → ${route.destination}:` : `${subject}:`,
    "",
    ...options.map(optionLine),
    "",
    `See the details and accept ${several ? "the one you like" : "it"} here${valid}:`,
    link,
  ];
  if (agencyName?.trim()) lines.push("", agencyName.trim());
  return lines.join("\n");
}
