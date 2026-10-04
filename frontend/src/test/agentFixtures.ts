import type {
  AgentAvailability,
  AgentFlightCard,
  AgentHotelCard,
  AgentRun,
  AgentRunDetail,
  AgentStep,
  AgentWeather,
  PlanResult,
} from "../api/agent";

/** Agent runs and steps shaped exactly like the API's (a DEL → DXB plan from the demo planner). */

export const RUN_ID = "11111111-2222-4333-8444-555555555555";
export const CREATED = "2026-10-04T10:00:00Z";

export const AVAILABLE_DEMO: AgentAvailability = { available: true, provider: "fake", model: "demo-planner", demo: true };
export const AVAILABLE_MODEL: AgentAvailability = { available: true, provider: "gemini", model: "gemini-2.5-flash", demo: false };
export const UNAVAILABLE: AgentAvailability = { available: false, provider: null, model: null, demo: false };

export function flightCard(overrides: Partial<AgentFlightCard> = {}): AgentFlightCard {
  return {
    offer_id: "F1",
    carrier: "6E",
    carrier_name: "IndiGo",
    flight_numbers: ["6E 1078", "6E 740"],
    slices: [
      {
        origin: "DEL",
        destination: "DXB",
        departs_at: "2026-11-20T17:20",
        departs_display: "20 Nov 2026, 17:20",
        arrives_at: "2026-11-20T20:39",
        arrives_display: "20 Nov 2026, 20:39",
        stops: 0,
        duration_minutes: 199,
        flight_numbers: ["6E 1078"],
      },
      {
        origin: "DXB",
        destination: "DEL",
        departs_at: "2026-11-24T11:10",
        departs_display: "24 Nov 2026, 11:10",
        arrives_at: "2026-11-24T14:29",
        arrives_display: "24 Nov 2026, 14:29",
        stops: 0,
        duration_minutes: 199,
        flight_numbers: ["6E 740"],
      },
    ],
    stops: 0,
    duration_minutes: 398,
    cabin: "economy",
    total_minor: 6_086_300,
    total_currency: "INR",
    total_formatted: "₹60,863",
    converted: false,
    fx_as_of: null,
    supplier_total_minor: 6_086_300,
    supplier_total_currency: "INR",
    supplier_total_formatted: "₹60,863",
    per_traveller_minor: 3_043_150,
    per_traveller_formatted: "₹30,431.50",
    provenance: "SANDBOX",
    fare_insight: null,
    fare_insight_note: null,
    co2_kg_per_passenger: null,
    refundable: false,
    checked_bags: 0,
    ...overrides,
  };
}

export const CONVERTED_FLIGHT = flightCard({
  offer_id: "F2",
  carrier: "EK",
  carrier_name: "Emirates",
  flight_numbers: ["EK 511", "EK 512"],
  total_minor: 8_331_000,
  total_formatted: "≈ ₹83,310",
  converted: true,
  fx_as_of: "2026-10-03",
  supplier_total_minor: 99_800,
  supplier_total_currency: "USD",
  supplier_total_formatted: "$998.00",
  per_traveller_formatted: "≈ ₹41,655",
  provenance: "LIVE",
  fare_insight: "good",
  fare_insight_note: "Below the usual range for this route.",
  co2_kg_per_passenger: 412,
  checked_bags: 1,
});

export const HOTEL: AgentHotelCard = {
  hotel_id: "H1",
  name: "Creek View Hotel",
  stars: 4,
  rating: 8.6,
  area: "Deira, Dubai",
  room: "Deluxe double",
  board: "Breakfast included",
  refundable: true,
  free_cancellation_until: "18 Nov 2026",
  total_minor: 4_200_000,
  total_currency: "INR",
  total_formatted: "₹42,000",
  converted: false,
  fx_as_of: null,
  supplier_total_minor: 4_200_000,
  supplier_total_currency: "INR",
  supplier_total_formatted: "₹42,000",
  per_night_minor: 1_050_000,
  per_night_formatted: "₹10,500",
  nights: 4,
  provenance: "SANDBOX",
};

export const WEATHER: AgentWeather = {
  place: { name: "Dubai", code: "DXB", latitude: 25.25, longitude: 55.37 },
  label: "typical",
  note: "Typical conditions: the average of these calendar days over the last 5 years, not a forecast.",
  units: { temperature: "°C", precipitation: "mm" },
  days: ["20", "21", "22", "23", "24"].map((day, index) => ({
    date: `2026-11-${day}`,
    date_display: `${day} Nov 2026`,
    temp_max_c: 30.4 + index / 10,
    temp_min_c: 21.3,
    precipitation_mm: 0,
    precipitation_chance_pct: 0,
    conditions: null,
  })),
  attribution: "Weather data by Open-Meteo.com (CC BY 4.0)",
};

export const TRIP = {
  origin: "DEL",
  origin_city: "New Delhi",
  destination: "DXB",
  destination_city: "Dubai",
  depart_date: "2026-11-20",
  depart_date_display: "20 Nov 2026",
  return_date: "2026-11-24",
  return_date_display: "24 Nov 2026",
  adults: 2,
  children_ages: [],
  cabin: "economy" as const,
};

export const SUMMARY =
  "Plan for DEL → DXB, 2026-11-20 to 2026-11-24, for 2 adults. Flights: 6 options; the first is 6E 1078, 6E 740 at ₹60,863 in total.";

export function planResult(overrides: Partial<PlanResult> = {}): PlanResult {
  return {
    summary: SUMMARY,
    trip: TRIP,
    flights: [flightCard(), CONVERTED_FLIGHT],
    hotels: [],
    places: [],
    itinerary: [],
    budget: null,
    weather: WEATHER,
    next_steps: [],
    fallback: false,
    ...overrides,
  };
}

export function agentRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: RUN_ID,
    kind: "agency",
    status: "done",
    prompt: "Delhi to Dubai for 2 adults, 20 Nov to 24 Nov, economy",
    provider: "fake",
    model: "demo-planner",
    demo: true,
    prompt_version: "2026-10-04.1",
    grounded: true,
    error: null,
    result: planResult(),
    pending: null,
    input_tokens: 0,
    output_tokens: 0,
    created_at: CREATED,
    started_at: CREATED,
    finished_at: "2026-10-04T10:00:01Z",
    ...overrides,
  };
}

const at = (seq: number) => `2026-10-04T10:00:0${Math.min(seq, 9)}Z`;

/** The demo planner's steps for the DEL → DXB plan, in order. */
export const PLAN_STEPS: AgentStep[] = [
  {
    seq: 0,
    kind: "tool_call",
    payload: { call_id: "c1", tool: "lookup_airport", args: { query: "Delhi" }, label: "Looking up airports for “Delhi”" },
    duration_ms: null,
    created_at: at(0),
  },
  {
    seq: 1,
    kind: "tool_result",
    payload: {
      call_id: "c1",
      tool: "lookup_airport",
      ok: true,
      summary: "Found 5 airports",
      data: { matches: [{ code: "DEL", name: "Indira Gandhi International Airport", city: "New Delhi", country: "India", country_code: "IN" }] },
      memo: false,
    },
    duration_ms: 156,
    created_at: at(1),
  },
  {
    seq: 2,
    kind: "tool_call",
    payload: {
      call_id: "c2",
      tool: "search_flights",
      args: { origin: "DEL", destination: "DXB", depart_date: "2026-11-20", return_date: "2026-11-24", adults: 2, cabin: "economy" },
      label: "Searching flights DEL → DXB",
    },
    duration_ms: null,
    created_at: at(2),
  },
  {
    seq: 3,
    kind: "tool_result",
    payload: {
      call_id: "c2",
      tool: "search_flights",
      ok: true,
      summary: "6 flight options from ₹60,863",
      data: { trip: TRIP, currency: "INR", offer_count: 6, offers: [flightCard(), CONVERTED_FLIGHT], sources: [] },
      memo: false,
    },
    duration_ms: 412,
    created_at: at(3),
  },
  {
    seq: 4,
    kind: "tool_call",
    payload: {
      call_id: "c3",
      tool: "weather_forecast",
      args: { place_or_airport: "DXB", start: "2026-11-20", end: "2026-11-24" },
      label: "Checking the weather in DXB",
    },
    duration_ms: null,
    created_at: at(4),
  },
  {
    seq: 5,
    kind: "tool_result",
    payload: { call_id: "c3", tool: "weather_forecast", ok: true, summary: "Typical weather for 5 days", data: { ...WEATHER }, memo: false },
    duration_ms: 16,
    created_at: at(5),
  },
  {
    seq: 6,
    kind: "guard",
    payload: { passed: true, action: "passed", violations: [] },
    duration_ms: null,
    created_at: at(6),
  },
  {
    seq: 7,
    kind: "answer",
    payload: { text: SUMMARY, grounded: true, fallback: false },
    duration_ms: 0,
    created_at: at(7),
  },
];

export function runDetail(overrides: Partial<AgentRunDetail> = {}): AgentRunDetail {
  return { ...agentRun(), steps: PLAN_STEPS, ...overrides };
}

export const QUESTION = {
  kind: "question" as const,
  call_id: "plan-1-1",
  question: "To plan this, tell me where you're travelling from, your travel dates and how many adults are travelling.",
  fields: ["origin", "depart_date", "adults"],
};

export const CONFIRM = {
  kind: "confirm" as const,
  call_id: "call-9",
  tool: "create_enquiry" as const,
  action: "Create an enquiry DEL → DXB, 20 Nov 2026 to 24 Nov 2026, for 2 adults.",
  args: { origin: "DEL", destination: "DXB", adults: 2 },
};
