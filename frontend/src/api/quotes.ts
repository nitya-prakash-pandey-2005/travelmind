import { mutationOptions, queryOptions, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { FlightOffer, Money } from "./offers";
import { TIMELINE_STALE_MS, type Timeline } from "./timeline";
import { queryString, RECORD_ROOTS, refreshWorkspace, segment } from "./workspaceCache";

/** Quotes, field for field with backend/src/travelmind/workspace/quotes.py. */

export type QuoteStatus = "draft" | "sent" | "viewed" | "accepted" | "declined" | "expired";
/** What an agent may set by hand, on a sent or viewed quote. */
export type QuoteDecisionStatus = "accepted" | "declined" | "expired";
export type MarkupKind = "percent" | "fixed";

/** A version holds 1 to this many options (distinct offers). */
export const MAX_QUOTE_OPTIONS = 3;
export const MAX_QUOTE_MESSAGE = 4000;
/** Percent markups are sent in basis points: 10000 = 100%. */
export const MAX_PERCENT_BP = 10_000;
/** Fixed markups are minor units, up to this. */
export const MAX_FIXED_MINOR = 1_000_000_000;
/** A share link stays valid this many days after each send. */
export const SHARE_TTL_DAYS = 14;

export type QuoteClientRef = { id: string; name: string };
export type QuoteEnquiryRef = {
  id: string;
  number: string;
  origin: string | null;
  destination: string | null;
  /** YYYY-MM-DD */
  depart_date: string | null;
};

export type QuoteSummary = {
  id: string;
  number: string;
  /** Overdue sent/viewed quotes already read as "expired" (the server expires them on read). */
  status: QuoteStatus;
  currency: string;
  client: QuoteClientRef | null;
  enquiry: QuoteEnquiryRef;
  /** 0 until the first version is saved. */
  current_version: number;
  /** The version the client's link shows; null until sent. */
  sent_version: number | null;
  /** The cheapest option's sell price in the current version, minor units of `currency`. */
  min_sell_minor: number | null;
  sent_at: string | null;
  created_at: string;
};

/** One priced option, frozen when the version was saved: the offer as shown, its markup and sell price. */
export type QuoteOption = { offer: FlightOffer; markup_minor: number; sell: Money };
export type QuoteTotals = { currency: string; min_sell_minor: number; max_sell_minor: number; options: number };

export type QuoteVersion = {
  version: number;
  message: string;
  options: QuoteOption[];
  totals: QuoteTotals;
  created_at: string;
  /** The user id of whoever saved it. */
  created_by: string | null;
};

export type QuoteDetail = QuoteSummary & {
  markup_kind: MarkupKind;
  /** Basis points for "percent", minor units for "fixed". */
  markup_value: number;
  share_expires_at: string | null;
  first_viewed_at: string | null;
  decided_at: string | null;
  /** The option the client accepted on their page (index into the sent version's options). */
  accepted_option: number | null;
  /** Newest first. */
  versions: QuoteVersion[];
};

export type QuoteList = { items: QuoteSummary[]; total: number };

/** POST /api/v1/quotes: currency defaults to the agency's, markup to 0%. */
export type QuoteCreate = {
  enquiry_id: string;
  currency?: string;
  markup_kind?: MarkupKind;
  markup_value?: number;
};

/**
 * POST /api/v1/quotes/{id}/versions. Offers are named by id only; the server prices them from its own
 * offer cache, so a price can never come from the browser. `option_markups` (one per offer, null keeps
 * the quote's markup) are in the quote's markup kind.
 */
export type QuoteVersionCreate = {
  offer_ids: string[];
  message?: string;
  option_markups?: (number | null)[] | null;
};

/** POST /api/v1/quotes/{id}/send: the token is returned this once; a re-send rotates it. */
export type QuoteSent = {
  /** Same-origin path, "/q/<token>". */
  share_url: string;
  token: string;
  expires_at: string;
};

/** GET /api/v1/quotes filters; the server allows limit 1–200 (default 50). */
export type QuoteFilters = {
  status?: QuoteStatus;
  client_id?: string;
  enquiry_id?: string;
  limit?: number;
  offset?: number;
};

const BASE = "/api/v1/quotes";

export const quotesApi = {
  list: (filters: QuoteFilters = {}, signal?: AbortSignal) =>
    apiFetch<QuoteList>(`${BASE}${queryString(filters)}`, { signal }),
  get: (id: string, signal?: AbortSignal) => apiFetch<QuoteDetail>(`${BASE}/${segment(id)}`, { signal }),
  create: (body: QuoteCreate) => apiFetch<QuoteDetail>(BASE, { method: "POST", body }),
  addVersion: (id: string, body: QuoteVersionCreate) =>
    apiFetch<QuoteDetail>(`${BASE}/${segment(id)}/versions`, { method: "POST", body }),
  send: (id: string) => apiFetch<QuoteSent>(`${BASE}/${segment(id)}/send`, { method: "POST" }),
  decide: (id: string, status: QuoteDecisionStatus) =>
    apiFetch<QuoteDetail>(`${BASE}/${segment(id)}/status`, { method: "POST", body: { status } }),
  activity: (id: string, signal?: AbortSignal) => apiFetch<Timeline>(`${BASE}/${segment(id)}/activity`, { signal }),
};

export const quoteKeys = {
  all: RECORD_ROOTS.quotes,
  list: (filters: QuoteFilters) => [...RECORD_ROOTS.quotes, "list", filters] as const,
  detail: (id: string) => [...RECORD_ROOTS.quotes, "detail", id] as const,
  activity: (id: string) => [...RECORD_ROOTS.quotes, "activity", id] as const,
};

export function quotesQueryOptions(filters: QuoteFilters = {}) {
  return queryOptions({
    queryKey: quoteKeys.list(filters),
    queryFn: ({ signal }) => quotesApi.list(filters, signal),
    staleTime: 30_000,
  });
}

export function quoteQueryOptions(id: string) {
  return queryOptions({
    queryKey: quoteKeys.detail(id),
    queryFn: ({ signal }) => quotesApi.get(id, signal),
    staleTime: 30_000,
  });
}

export function quoteActivityQueryOptions(id: string) {
  return queryOptions({
    queryKey: quoteKeys.activity(id),
    queryFn: ({ signal }) => quotesApi.activity(id, signal),
    staleTime: TIMELINE_STALE_MS,
  });
}

/** The link to give the client: the share path on this app's origin. */
export function shareUrl(sent: Pick<QuoteSent, "share_url">, origin: string = window.location.origin): string {
  return new URL(sent.share_url, origin).toString();
}

function stored(client: QueryClient, quote: QuoteDetail): void {
  client.setQueryData(quoteKeys.detail(quote.id), quote);
  refreshWorkspace(client);
}

export function createQuoteMutation(client: QueryClient) {
  return mutationOptions({
    mutationFn: (body: QuoteCreate) => quotesApi.create(body),
    onSuccess: (quote) => stored(client, quote),
  });
}

/** Returns the quote with the new version priced by the server: that is the preview to show. */
export function addQuoteVersionMutation(client: QueryClient) {
  return mutationOptions({
    mutationFn: ({ id, version }: { id: string; version: QuoteVersionCreate }) => quotesApi.addVersion(id, version),
    onSuccess: (quote) => stored(client, quote),
  });
}

/** Takes the quote id; the result holds the only copy of the share token. */
export function sendQuoteMutation(client: QueryClient) {
  return mutationOptions({
    mutationFn: (id: string) => quotesApi.send(id),
    onSuccess: () => refreshWorkspace(client),
  });
}

export function decideQuoteMutation(client: QueryClient) {
  return mutationOptions({
    mutationFn: ({ id, status }: { id: string; status: QuoteDecisionStatus }) => quotesApi.decide(id, status),
    onSuccess: (quote) => stored(client, quote),
  });
}

export const useCreateQuote = () => useMutation(createQuoteMutation(useQueryClient()));
export const useAddQuoteVersion = () => useMutation(addQuoteVersionMutation(useQueryClient()));
export const useSendQuote = () => useMutation(sendQuoteMutation(useQueryClient()));
export const useDecideQuote = () => useMutation(decideQuoteMutation(useQueryClient()));
