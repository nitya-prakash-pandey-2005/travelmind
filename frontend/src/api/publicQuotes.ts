import { mutationOptions, queryOptions, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { Cabin, Money } from "./offers";
import { segment } from "./workspaceCache";

/**
 * The client's quote page (/q/:token), field for field with
 * backend/src/travelmind/workspace/public_quotes.py. No sign-in; only what a client should see.
 */

export type PublicQuoteStatus = "sent" | "viewed" | "accepted" | "declined" | "expired";

export const INDICATIVE_PRICE_LABEL = "Indicative price — confirm with your travel agent";
export const LIVE_PRICE_LABEL = "Live fare at the time of quoting";
export type PriceLabel = typeof INDICATIVE_PRICE_LABEL | typeof LIVE_PRICE_LABEL;

export type PublicAgency = {
  name: string;
  /** "#rrggbb" */
  brand_color: string;
  /** IANA time zone: dates such as the expiry read as the agency's local dates. */
  timezone: string;
};

export type PublicSegment = {
  marketing_carrier: string;
  flight_number: string;
  origin: string;
  destination: string;
  /** Airport-local time without an offset, as the supplier gave it. */
  departing_at: string;
  arriving_at: string;
};

export type PublicSlice = {
  origin: string;
  destination: string;
  departing_at: string;
  arriving_at: string;
  duration_minutes: number | null;
  stops: number;
  segments: PublicSegment[];
};

export type PublicBaggage = { checked: number | null; carry_on: number | null };

export type PublicOption = {
  index: number;
  carrier_code: string;
  carrier_name: string | null;
  cabin: Cabin | null;
  slices: PublicSlice[];
  baggage: PublicBaggage;
  refundable: boolean | null;
  changeable: boolean | null;
  co2_kg_per_passenger: number | null;
  price_label: PriceLabel;
  sell: Money;
  /** An even share of the sell price, only for an adults-only party of two or more. */
  per_traveller: Money | null;
};

export type PublicQuote = {
  number: string;
  /** Rely on this, not on `decided_at`: an expired quote may have no decision time. */
  status: PublicQuoteStatus;
  agency: PublicAgency;
  client_first_name: string | null;
  message: string;
  options: PublicOption[];
  currency: string;
  expires_at: string | null;
  decided_at: string | null;
  /** The accepted option's index, once accepted. */
  accepted_option: number | null;
};

/** `option_index` is required to accept and must be one of the options shown. */
export type PublicDecision = { decision: "accept" | "decline"; option_index?: number };

/**
 * Server messages the page shows as they are: 404 "This quote link isn't valid. Ask your travel agent
 * for a new one.", 410 "This quote has expired. Ask your travel agent for a fresh one.", 409 "This
 * quote has already been accepted|declined.", 429 "Too many requests. Please try again in a minute."
 */
export const publicQuotesApi = {
  get: (token: string, signal?: AbortSignal) =>
    apiFetch<PublicQuote>(`/api/v1/public/quotes/${segment(token)}`, { signal }),
  decide: (token: string, body: PublicDecision) =>
    apiFetch<PublicQuote>(`/api/v1/public/quotes/${segment(token)}/decision`, { method: "POST", body }),
};

export const publicQuoteKeys = {
  quote: (token: string) => ["public-quote", token] as const,
};

/**
 * Read once per visit: the first read of a sent quote marks it viewed, and every read counts against
 * the link's rate limit, so no background refetching or retries. A 401 never sends the visitor to sign in.
 */
export function publicQuoteQueryOptions(token: string) {
  return queryOptions({
    queryKey: publicQuoteKeys.quote(token),
    queryFn: ({ signal }) => publicQuotesApi.get(token, signal),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    meta: { skipAuthRedirect: true },
  });
}

/** The page shows the returned state; a 401 here never sends the visitor to the sign-in page. */
export function publicQuoteDecisionMutation(client: QueryClient, token: string) {
  return mutationOptions({
    mutationFn: (decision: PublicDecision) => publicQuotesApi.decide(token, decision),
    onSuccess: (quote) => client.setQueryData(publicQuoteKeys.quote(token), quote),
    meta: { skipAuthRedirect: true },
  });
}

export const usePublicQuoteDecision = (token: string) =>
  useMutation(publicQuoteDecisionMutation(useQueryClient(), token));
