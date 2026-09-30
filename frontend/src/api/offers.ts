import { apiFetch } from "./client";

export type Money = { amount_minor: number; currency: string };
export type Provenance = "LIVE" | "CACHED" | "SANDBOX";
export type Cabin = "economy" | "premium_economy" | "business" | "first";

export type Segment = {
  origin: string;
  destination: string;
  /** Airport-local time without an offset, e.g. "2026-11-20T06:10:00". */
  departing_at: string;
  arriving_at: string;
  marketing_carrier: string;
  marketing_carrier_name: string | null;
  flight_number: string;
  operating_carrier: string | null;
  operating_flight_number: string | null;
  duration_minutes: number | null;
};

export type Slice = {
  origin: string;
  destination: string;
  duration_minutes: number | null;
  fare_brand: string | null;
  segments: Segment[];
  stops: number;
};

export type Insight = { signal: "good" | "typical" | "high"; delta_pct: number; message: string };

export type FlightOffer = {
  id: string;
  supplier: string;
  supplier_ref: string;
  provenance: Provenance;
  total: Money;
  base: Money | null;
  tax: Money | null;
  owner_carrier: string;
  owner_name: string | null;
  cabin: Cabin | null;
  passenger_count: number;
  slices: Slice[];
  baggage: { checked: number | null; carry_on: number | null };
  conditions: {
    refundable: boolean | null;
    refund_penalty: Money | null;
    changeable: boolean | null;
    change_penalty: Money | null;
  };
  co2_kg_per_passenger: number | null;
  co2_source: "google_tim" | "google_tim_typical" | "supplier" | null;
  fetched_at: string;
  expires_at: string | null;
  stops: number;
  total_duration_minutes: number | null;
  /** The total in the agency's display currency; null when no exchange rate is available. */
  display_total: Money | null;
  /**
   * One traveller's fare in the display currency, set only when the offer is comparable with fare
   * history (adults-only party, billed in the display currency, from the baseline's family).
   */
  per_traveller: Money | null;
  insight: Insight | null;
};

export type Baseline = {
  family: "market" | "sandbox";
  currency: string;
  sample_size: number;
  p25_minor: number;
  median_minor: number;
  p75_minor: number;
  window_days: number;
};

export type SourceStatus = {
  supplier: string;
  status: "ok" | "error" | "timeout" | "not_configured";
  offer_count: number;
  latency_ms: number;
  message: string | null;
};

export type FlightSearchRequest = {
  origin: string;
  destination: string;
  departure_date: string;
  return_date: string | null;
  adults: number;
  children_ages: number[];
  cabin: Cabin;
  max_connections: number;
};

export type FlightSearchResponse = {
  search_id: string;
  display_currency: string;
  fx_as_of: string | null;
  baseline: Baseline | null;
  sources: SourceStatus[];
  offers: FlightOffer[];
};

export type RepriceResponse = { offer: FlightOffer; price_changed: boolean; previous_total: Money };

export type SupplierStatus = {
  code: string;
  name: string;
  kind: "flights" | "hotels" | "emissions" | "price_history" | "exchange_rates";
  connected: boolean;
  mode: "live" | "test" | "sandbox" | null;
  detail: string;
};

export type HotelSearchRequest = {
  destination: string;
  checkin: string;
  checkout: string;
  rooms: { adults: number; children_ages: number[] }[];
};

export type HotelOffer = {
  id: string;
  supplier: string;
  provenance: Provenance;
  hotel_id: string;
  name: string;
  stars: number | null;
  rating: number | null;
  address: string | null;
  photo_url: string | null;
  room_name: string | null;
  board: string | null;
  total: Money;
  refundable: boolean | null;
  free_cancellation_until: string | null;
  nights: number;
  fetched_at: string;
  display_total: Money | null;
};

export type HotelSearchResponse = {
  display_currency: string;
  /** Date of the exchange rates behind any converted display_total; null if nothing was converted. */
  fx_as_of: string | null;
  nights: number;
  sources: SourceStatus[];
  offers: HotelOffer[];
};

export const offersApi = {
  searchFlights(body: FlightSearchRequest, signal?: AbortSignal): Promise<FlightSearchResponse> {
    return apiFetch<FlightSearchResponse>("/api/v1/flights/search", { method: "POST", body, signal });
  },
  reprice(offerId: string): Promise<RepriceResponse> {
    return apiFetch<RepriceResponse>(`/api/v1/flights/offers/${encodeURIComponent(offerId)}/price`, {
      method: "POST",
    });
  },
  searchHotels(body: HotelSearchRequest, signal?: AbortSignal): Promise<HotelSearchResponse> {
    return apiFetch<HotelSearchResponse>("/api/v1/hotels/search", { method: "POST", body, signal });
  },
  suppliers(signal?: AbortSignal): Promise<SupplierStatus[]> {
    return apiFetch<SupplierStatus[]>("/api/v1/suppliers", { signal });
  },
};
