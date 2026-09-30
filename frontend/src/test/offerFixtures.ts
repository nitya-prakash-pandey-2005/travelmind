import type { FlightOffer, FlightSearchResponse, Segment } from "../api/offers";

export function segment(
  origin: string,
  destination: string,
  departing: string,
  arriving: string,
  carrier = "6E",
  flightNumber = "2045",
  minutes = 130,
): Segment {
  return {
    origin,
    destination,
    departing_at: departing,
    arriving_at: arriving,
    marketing_carrier: carrier,
    marketing_carrier_name: null,
    flight_number: flightNumber,
    operating_carrier: carrier,
    operating_flight_number: null,
    duration_minutes: minutes,
  };
}

/** A sandbox DEL→BOM nonstop on IndiGo for ₹5,234; override what a test cares about. */
export function makeOffer(overrides: Partial<FlightOffer> = {}): FlightOffer {
  return {
    id: "sandbox~ref-1",
    supplier: "sandbox",
    supplier_ref: "ref-1",
    provenance: "SANDBOX",
    total: { amount_minor: 523400, currency: "INR" },
    base: null,
    tax: null,
    owner_carrier: "6E",
    owner_name: "IndiGo",
    cabin: "economy",
    passenger_count: 1,
    slices: [
      {
        origin: "DEL",
        destination: "BOM",
        duration_minutes: 130,
        fare_brand: "Saver",
        segments: [segment("DEL", "BOM", "2026-11-20T06:10:00", "2026-11-20T08:20:00")],
        stops: 0,
      },
    ],
    baggage: { checked: 1, carry_on: 1 },
    conditions: { refundable: false, refund_penalty: null, changeable: true, change_penalty: null },
    co2_kg_per_passenger: 98,
    co2_source: "google_tim",
    fetched_at: "2026-09-29T10:00:00Z",
    expires_at: "2026-09-29T10:30:00Z",
    stops: 0,
    total_duration_minutes: 130,
    display_total: { amount_minor: 523400, currency: "INR" },
    per_traveller: { amount_minor: 523400, currency: "INR" },
    insight: null,
    ...overrides,
  };
}

export function searchResponse(overrides: Partial<FlightSearchResponse> = {}): FlightSearchResponse {
  return {
    search_id: "s-1",
    display_currency: "INR",
    fx_as_of: null,
    baseline: null,
    sources: [{ supplier: "sandbox", status: "ok", offer_count: 1, latency_ms: 12, message: null }],
    offers: [makeOffer()],
    ...overrides,
  };
}
