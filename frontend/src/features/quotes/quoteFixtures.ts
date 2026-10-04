import type { FlightOffer } from "../../api/offers";
import type { QuoteClientRef, QuoteDetail, QuoteList, QuoteOption, QuoteStatus, QuoteSummary, QuoteVersion } from "../../api/quotes";
import { isoDateFromNow } from "../../lib/dates";
import { makeOffer, segment } from "../../test/offerFixtures";

/** Test data for the quote screens, field for field with the backend's quote schemas. */

const DAY_MS = 86_400_000;

/**
 * A calendar date `days` from today, YYYY-MM-DD, in the local time zone (as the screens count days). A UTC date
 * would be a day behind between local midnight and the UTC offset, e.g. 00:00-05:30 in India.
 */
export function dayFromToday(days: number): string {
  return isoDateFromNow(days);
}

/** An ISO timestamp `minutes` ago. */
export function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

export const INDIGO = makeOffer({ id: "sandbox~6e", supplier_ref: "6e-ref" });
export const AIR_INDIA = makeOffer({
  id: "sandbox~ai",
  supplier_ref: "ai-ref",
  owner_carrier: "AI",
  owner_name: "Air India",
  total: { amount_minor: 612_000, currency: "INR" },
  display_total: { amount_minor: 612_000, currency: "INR" },
  slices: [
    {
      origin: "DEL",
      destination: "BOM",
      duration_minutes: 130,
      fare_brand: "Value",
      segments: [segment("DEL", "BOM", "2026-11-20T09:00:00", "2026-11-20T11:10:00", "AI", "865")],
      stops: 0,
    },
  ],
});
export const VISTARA = makeOffer({
  id: "sandbox~uk",
  supplier_ref: "uk-ref",
  owner_carrier: "UK",
  owner_name: "Vistara",
  total: { amount_minor: 701_000, currency: "INR" },
  display_total: { amount_minor: 701_000, currency: "INR" },
});
export const AKASA = makeOffer({
  id: "sandbox~qp",
  supplier_ref: "qp-ref",
  owner_carrier: "QP",
  owner_name: "Akasa Air",
  total: { amount_minor: 498_000, currency: "INR" },
  display_total: { amount_minor: 498_000, currency: "INR" },
});
/** Billed in dollars: it can't go on a rupee quote. */
export const UNITED = makeOffer({
  id: "duffel~ua",
  supplier: "duffel",
  supplier_ref: "ua-ref",
  provenance: "LIVE",
  owner_carrier: "UA",
  owner_name: "United",
  total: { amount_minor: 9_900, currency: "USD" },
  display_total: { amount_minor: 830_000, currency: "INR" },
});

export function quoteOption(offer: FlightOffer, markupMinor: number, sellMinor?: number): QuoteOption {
  return {
    offer,
    markup_minor: markupMinor,
    sell: { amount_minor: sellMinor ?? offer.total.amount_minor + markupMinor, currency: offer.total.currency },
  };
}

export function quoteVersion(version: number, options: QuoteOption[], extra: Partial<QuoteVersion> = {}): QuoteVersion {
  const sells = options.map((option) => option.sell.amount_minor);
  return {
    version,
    message: "",
    options,
    totals: { currency: "INR", min_sell_minor: Math.min(...sells), max_sell_minor: Math.max(...sells), options: options.length },
    created_at: minutesAgo(60 * (10 - version)),
    created_by: "u-owner",
    ...extra,
  };
}

export const ENQUIRY_REF = { id: "e-5", number: "E-0005", origin: "DEL", destination: "BOM", depart_date: dayFromToday(21) };
export const PRIYA: QuoteClientRef = { id: "c-priya", name: "Priya Sharma", kind: "individual" };

/** The server's value rule (backend quotes.py): accepted option, else cheapest sent, else cheapest current. */
function valueOf(quote: Pick<QuoteDetail, "status" | "sent_version" | "accepted_option" | "versions">): number | null {
  const sent = quote.versions.find((v) => v.version === quote.sent_version);
  const valued = sent ?? quote.versions[0];
  if (!valued) return null;
  const accepted = quote.status === "accepted" && quote.accepted_option !== null ? valued.options[quote.accepted_option] : undefined;
  return accepted ? accepted.sell.amount_minor : valued.totals.min_sell_minor;
}

export function quoteDetail(overrides: Partial<QuoteDetail> = {}): QuoteDetail {
  const versions = overrides.versions ?? [];
  const latest = versions[0];
  const detail: QuoteDetail = {
    id: "q-4",
    number: "Q-0004",
    status: "draft",
    currency: "INR",
    client: PRIYA,
    enquiry: ENQUIRY_REF,
    current_version: latest?.version ?? 0,
    sent_version: null,
    min_sell_minor: latest?.totals.min_sell_minor ?? null,
    value_minor: null,
    sent_at: null,
    created_at: minutesAgo(600),
    markup_kind: "percent",
    markup_value: 1000,
    share_expires_at: null,
    first_viewed_at: null,
    decided_at: null,
    accepted_option: null,
    versions,
    ...overrides,
  };
  return "value_minor" in overrides ? detail : { ...detail, value_minor: valueOf(detail) };
}

/** Q-0004 sent at v2 and since revised to v3, which is cheaper. */
export function sentQuote(overrides: Partial<QuoteDetail> = {}): QuoteDetail {
  const v3 = quoteVersion(3, [quoteOption(INDIGO, 52_340), quoteOption(AIR_INDIA, 61_200)], { message: "Two morning options." });
  const v2 = quoteVersion(2, [quoteOption(VISTARA, 70_100), quoteOption(AIR_INDIA, 61_200)]);
  const v1 = quoteVersion(1, [quoteOption(VISTARA, 70_100)]);
  return quoteDetail({
    status: "sent",
    versions: [v3, v2, v1],
    sent_version: 2,
    sent_at: minutesAgo(300),
    share_expires_at: new Date(Date.now() + 13 * DAY_MS).toISOString(),
    ...overrides,
  });
}

/** A list row; its value defaults to its cheapest current option (as for a draft) unless given. */
export function quoteSummary(overrides: Partial<QuoteSummary> = {}): QuoteSummary {
  const min = overrides.min_sell_minor === undefined ? 575_740 : overrides.min_sell_minor;
  return {
    id: "q-4",
    number: "Q-0004",
    status: "draft",
    currency: "INR",
    client: PRIYA,
    enquiry: ENQUIRY_REF,
    current_version: 1,
    sent_version: null,
    min_sell_minor: min,
    value_minor: min,
    sent_at: null,
    decided_at: null,
    created_at: minutesAgo(600),
    ...overrides,
  };
}

/** A list response as the server sends it: these rows, with the counts per status taken from them. */
export function quoteList(items: QuoteSummary[]): QuoteList {
  const counts: Record<QuoteStatus, number> = { draft: 0, sent: 0, viewed: 0, accepted: 0, declined: 0, expired: 0 };
  for (const quote of items) counts[quote.status] += 1;
  return { items, total: items.length, counts };
}
