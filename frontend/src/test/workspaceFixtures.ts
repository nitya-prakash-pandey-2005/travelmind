import { AIRPORTS } from "./fixtures";
import type { MockCall, MockHandler } from "./mockApi";

const RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };
const DAY_MS = 86_400_000;

/** `days` calendar dates ending today, oldest first, each with the value `valueAt(index)`. */
function series(days: number, valueAt: (index: number) => number): { date: string; value: number }[] {
  const today = new Date();
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(today);
    day.setUTCDate(today.getUTCDate() - (days - 1 - index));
    return { date: day.toISOString().slice(0, 10), value: valueAt(index) };
  });
}

/** A local calendar date `days` from today as YYYY-MM-DD. */
function dateFromToday(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
}

/** An ISO UTC timestamp `minutes` ago. */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

const KPIS = [
  { key: "open_enquiries", label: "Open enquiries", unit: "count", empty: 0 },
  { key: "quotes_sent", label: "Quotes sent", unit: "count", empty: 0 },
  { key: "win_rate", label: "Win rate", unit: "percent", empty: null },
  { key: "pipeline_value", label: "Pipeline value", unit: "money", empty: 0 },
  { key: "response_time", label: "Response time", unit: "minutes", empty: null },
  { key: "co2_quoted", label: "CO₂ quoted", unit: "kg", empty: null },
  { key: "searches", label: "Searches", unit: "count", empty: 0 },
] as const;

type KpiKey = (typeof KPIS)[number]["key"];

/** A busy agency's figures: value, previous period and a daily series (whole numbers, like the API's). */
const POPULATED_KPIS: Record<KpiKey, { value: number; previous: number | null; daily: (index: number) => number }> = {
  open_enquiries: { value: 12, previous: 10, daily: (i) => [0, 1, 2, 1, 0, 3, 1][i % 7] ?? 0 },
  quotes_sent: { value: 18, previous: 15, daily: (i) => [1, 0, 2, 1, 1, 0, 2][i % 7] ?? 0 },
  win_rate: { value: 58.3, previous: 50, daily: (i) => (i % 5 === 0 ? 1 : 0) },
  // ₹6,20,000 in paise.
  pipeline_value: { value: 62_000_000, previous: null, daily: (i) => (i % 3 === 0 ? 4_500_000 : 0) },
  // The daily median is 0 on days without a first send.
  response_time: { value: 42.5, previous: 55, daily: (i) => (i % 4 === 0 ? 0 : 30 + (i % 6) * 5) },
  co2_quoted: { value: 1240, previous: 980, daily: (i) => (i % 2 === 0 ? 85 : 0) },
  searches: { value: 146, previous: 120, daily: (i) => 3 + (i % 5) },
};

/** Agency details and sending quotes have no screen yet: the API lists them as coming, without a link. */
const ONBOARDING_ITEMS = [
  { key: "profile", label: "Add your agency details", available: false, href: null },
  { key: "supplier", label: "Connect a live supplier", available: true, href: "/app/suppliers" },
  { key: "team", label: "Invite a teammate", available: true, href: "/app/team" },
  { key: "fare_scan", label: "Run your first fare scan", available: true, href: "/app/fares" },
  { key: "client", label: "Add a client", available: true, href: "/app" },
  { key: "quote", label: "Send your first quote", available: false, href: null },
] as const;

const ASHA = { id: "u-owner", full_name: "Asha Rao" };
const RAVI = { id: "u-agent", full_name: "Ravi Kumar" };
const NEHA = { id: "u-neha", full_name: "Neha Singh" };

/** Activity items shaped like GET /api/v1/dashboard/activity, newest first. */
function activityItems(): unknown[] {
  const recent = [
    {
      kind: "search.flights",
      summary: "Searched DEL → BOM for 2 travellers · 14 offers",
      actor: ASHA,
      entity_type: null,
      minutes: 5,
    },
    { kind: "quote.accepted", summary: "Priya Sharma accepted Q-0004", actor: null, entity_type: "quote", minutes: 18 },
    { kind: "quote.sent", summary: "Sent Q-0004 to Priya Sharma", actor: RAVI, entity_type: "quote", minutes: 64 },
    { kind: "enquiry.created", summary: "New enquiry E-0006 · BOM → GOI", actor: NEHA, entity_type: "enquiry", minutes: 190 },
    { kind: "client.updated", summary: "Updated client Rahul Mehta", actor: ASHA, entity_type: "client", minutes: 300 },
    { kind: "supplier.price_checked", summary: "Re-checked a sandbox fare", actor: RAVI, entity_type: null, minutes: 420 },
  ];
  const filler = Array.from({ length: 14 }, (_, index) => ({
    kind: index % 2 === 0 ? "search.hotels" : "enquiry.status_changed",
    summary: index % 2 === 0 ? "Searched hotels near GOI · 9 offers" : `E-000${(index % 5) + 1} moved to quoting`,
    actor: index % 3 === 0 ? RAVI : ASHA,
    entity_type: index % 2 === 0 ? null : "enquiry",
    minutes: 600 + index * 240,
  }));
  return [...recent, ...filler].map((item, index) => ({
    id: `act-${String(index + 1).padStart(2, "0")}`,
    kind: item.kind,
    summary: item.summary,
    occurred_at: minutesAgo(item.minutes),
    actor: item.actor,
    entity_type: item.entity_type,
    entity_id: item.entity_type ? `ent-${index + 1}` : null,
  }));
}

/** An older page, served when the client pages back with `before` + `before_id`. */
function olderActivityItems(): unknown[] {
  return [
    {
      id: "act-old-1",
      kind: "client.deleted",
      summary: "Removed client Old Contact",
      occurred_at: minutesAgo(9 * 24 * 60),
      actor: ASHA,
      entity_type: "client",
      entity_id: "c-old",
    },
    {
      id: "act-old-2",
      kind: "team.joined",
      summary: "Neha Singh joined the team",
      occurred_at: minutesAgo(12 * 24 * 60),
      actor: NEHA,
      entity_type: null,
      entity_id: null,
    },
  ];
}

type EnquirySeed = {
  id: string;
  number: string;
  origin: string | null;
  destination: string | null;
  status: string;
  client: { id: string; name: string } | null;
};

/** One item of GET /api/v1/enquiries, field for field with the backend's EnquiryOut. */
export function enquiryOut(seed: EnquirySeed): Record<string, unknown> {
  const created = minutesAgo(3 * 24 * 60);
  return {
    id: seed.id,
    number: seed.number,
    client: seed.client,
    source: "manual",
    raw_text: null,
    origin: seed.origin,
    destination: seed.destination,
    depart_date: dateFromToday(21),
    return_date: dateFromToday(28),
    adults: 2,
    children_ages: [],
    cabin: "economy",
    budget: null,
    notes: null,
    status: seed.status,
    lost_reason: null,
    assignee: ASHA,
    created_at: created,
    updated_at: created,
    closed_at: seed.status === "won" || seed.status === "lost" ? created : null,
    quote_count: seed.status === "new" ? 0 : 1,
  };
}

const PRIYA = { id: "c-priya", name: "Priya Sharma" };
const RAHUL = { id: "c-rahul", name: "Rahul Mehta" };

const ENQUIRIES: EnquirySeed[] = [
  { id: "e-6", number: "E-0006", origin: "BOM", destination: "GOI", status: "new", client: RAHUL },
  { id: "e-5", number: "E-0005", origin: "DEL", destination: "BOM", status: "quoted", client: PRIYA },
  { id: "e-4", number: "E-0004", origin: "DEL", destination: "BOM", status: "won", client: PRIYA },
  { id: "e-3", number: "E-0003", origin: "LHR", destination: "JFK", status: "quoting", client: null },
  { id: "e-2", number: "E-0002", origin: "DEL", destination: null, status: "new", client: RAHUL },
];

/** One item of GET /api/v1/clients, field for field with the backend's ClientOut. */
export function clientOut(id: string, name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const created = minutesAgo(10 * 24 * 60);
  return {
    id,
    kind: "individual",
    name,
    email: null,
    phone: null,
    company_name: null,
    home_airport: null,
    notes: null,
    tags: [],
    created_at: created,
    updated_at: created,
    enquiry_count: 0,
    quote_count: 0,
    ...extra,
  };
}

const CLIENTS = [
  clientOut(PRIYA.id, PRIYA.name, { email: "priya@example.com", company_name: "Sharma Exports", enquiry_count: 2 }),
  clientOut(RAHUL.id, RAHUL.name, { email: "rahul@example.com", enquiry_count: 2 }),
];

/** Airport lookup by code or city, like GET /api/v1/reference/airports for the fixture airports. */
function airportSearch(call: MockCall) {
  const q = (call.search.get("q") ?? "").trim().toLowerCase();
  const body = Object.values(AIRPORTS).filter(
    (a) => a.iata_code.toLowerCase() === q || (q.length >= 3 && (a.city ?? "").toLowerCase().startsWith(q)),
  );
  return { status: 200, body };
}

function clientSearch(call: MockCall, populated: boolean) {
  const q = (call.search.get("q") ?? "").trim().toLowerCase();
  const items = populated ? CLIENTS.filter((c) => String(c.name).toLowerCase().includes(q)) : [];
  return { status: 200, body: { items, total: items.length } };
}

/**
 * API responses for everything the app shell and the Command Center request, shaped exactly like the
 * backend's (see the dashboard, notifications, onboarding, search, enquiry and client schemas). Test-only.
 * By default a brand-new, empty workspace; `populated: true` is a busy agency with a month of work.
 */
export function commandCenterMocks({ populated = false }: { populated?: boolean } = {}): Record<string, MockHandler> {
  return {
    "GET /api/v1/dashboard/summary": (call) => {
      const range = call.search.get("range") ?? "30d";
      const days = RANGE_DAYS[range] ?? 30;
      return {
        status: 200,
        body: {
          range,
          currency: "INR",
          kpis: KPIS.map(({ key, label, unit, empty }) => {
            const figures = POPULATED_KPIS[key];
            return {
              key,
              label,
              value: populated ? figures.value : empty,
              unit,
              previous: key === "pipeline_value" ? null : populated ? figures.previous : empty,
              series: series(days, populated ? figures.daily : () => 0),
            };
          }),
        },
      };
    },
    "GET /api/v1/dashboard/pipeline": {
      status: 200,
      body: {
        currency: "INR",
        stages: populated
          ? [
              { status: "new", count: 5, value_minor: 0 },
              { status: "quoting", count: 4, value_minor: 21_000_000 },
              { status: "quoted", count: 3, value_minor: 18_600_000 },
              { status: "won", count: 2, value_minor: 12_400_000 },
              { status: "lost", count: 1, value_minor: 5_200_000 },
            ]
          : (["new", "quoting", "quoted", "won", "lost"] as const).map((status) => ({ status, count: 0, value_minor: 0 })),
      },
    },
    "GET /api/v1/dashboard/activity": (call) => {
      if (!populated) return { status: 200, body: { items: [] } };
      return { status: 200, body: { items: call.search.get("before") ? olderActivityItems() : activityItems() } };
    },
    "GET /api/v1/dashboard/market-pulse": {
      status: 200,
      body: {
        currency: "INR",
        routes: populated
          ? [
              {
                origin: "DEL",
                destination: "BOM",
                current_minor: 450_000,
                previous_minor: 505_000,
                change_pct: -10.9,
                samples: 12,
                weekly: [null, 498_000, 512_000, 505_000, 490_000, 470_000, 462_000, 450_000],
                provenance: "SANDBOX",
              },
              {
                origin: "BOM",
                destination: "GOI",
                current_minor: 390_000,
                previous_minor: 360_500,
                change_pct: 8.2,
                samples: 9,
                weekly: [350_000, 355_000, null, 360_000, 362_000, 361_000, 372_000, 390_000],
                provenance: "LIVE",
              },
              {
                origin: "LHR",
                destination: "JFK",
                current_minor: 5_450_000,
                previous_minor: 5_450_000,
                change_pct: 0,
                samples: 4,
                weekly: [null, null, null, null, 5_450_000, 5_450_000, null, 5_450_000],
                provenance: "MIXED",
              },
            ]
          : [],
      },
    },
    "GET /api/v1/dashboard/supplier-health": (call) => ({
      status: 200,
      body: {
        suppliers: populated
          ? [
              {
                supplier: "sandbox",
                kind: "flights",
                calls: call.search.get("range") === "7d" ? 240 : 42,
                ok: call.search.get("range") === "7d" ? 236 : 40,
                success_pct: call.search.get("range") === "7d" ? 98.3 : 95.2,
                p50_ms: 180,
                p95_ms: 420,
                avg_offers: 12.4,
              },
              {
                supplier: "duffel",
                kind: "flights",
                calls: 18,
                ok: 15,
                success_pct: 83.3,
                p50_ms: 820,
                p95_ms: 2100,
                avg_offers: 38.5,
              },
              {
                supplier: "liteapi",
                kind: "hotels",
                calls: 6,
                ok: 0,
                success_pct: 0,
                p50_ms: null,
                p95_ms: null,
                avg_offers: null,
              },
            ]
          : [],
      },
    }),
    "GET /api/v1/dashboard/team": {
      status: 200,
      body: {
        members: populated
          ? [
              { user: { ...ASHA, role: "owner" }, enquiries: 9, quotes_sent: 11, won_value_minor: 8_200_000 },
              { user: { ...RAVI, role: "agent" }, enquiries: 6, quotes_sent: 5, won_value_minor: 4_200_000 },
              { user: { ...NEHA, role: "agent" }, enquiries: 3, quotes_sent: 2, won_value_minor: 0 },
            ]
          : [{ user: { ...ASHA, role: "owner" }, enquiries: 0, quotes_sent: 0, won_value_minor: 0 }],
      },
    },
    "GET /api/v1/dashboard/departures": {
      status: 200,
      body: {
        items: populated
          ? [
              {
                enquiry_id: "e-4",
                number: "E-0004",
                client: "Priya Sharma",
                origin: "DEL",
                destination: "BOM",
                depart_date: dateFromToday(3),
                travellers: 2,
              },
              {
                enquiry_id: "e-1",
                number: "E-0001",
                client: null,
                origin: "BOM",
                destination: null,
                depart_date: dateFromToday(12),
                travellers: 1,
              },
            ]
          : [],
      },
    },
    "GET /api/v1/onboarding": {
      status: 200,
      body: {
        items: ONBOARDING_ITEMS.map((item, index) => ({ ...item, done: populated && index < 3 })),
        completed: populated ? 3 : 0,
        total: 6,
      },
    },
    "GET /api/v1/notifications": { status: 200, body: { unread: 0, items: [] } },
    "POST /api/v1/notifications/seen": { status: 204 },
    "GET /api/v1/search": { status: 200, body: { clients: [], enquiries: [], quotes: [] } },
    "GET /api/v1/enquiries": {
      status: 200,
      body: populated ? { items: ENQUIRIES.map(enquiryOut), total: ENQUIRIES.length } : { items: [], total: 0 },
    },
    "POST /api/v1/enquiries": (call) => {
      const body = call.body as Record<string, unknown>;
      return {
        status: 201,
        body: enquiryOut({
          id: "e-7",
          number: "E-0007",
          origin: (body.origin as string | null) ?? null,
          destination: (body.destination as string | null) ?? null,
          status: "new",
          client: body.client_id ? { id: String(body.client_id), name: "Client" } : null,
        }),
      };
    },
    "GET /api/v1/clients": (call) => clientSearch(call, populated),
    "POST /api/v1/clients": (call) => {
      const body = call.body as Record<string, unknown>;
      return { status: 201, body: clientOut("c-new", String(body.name)) };
    },
    "GET /api/v1/reference/airports": airportSearch,
    "GET /api/v1/suppliers": {
      status: 200,
      body: [
        {
          code: "sandbox",
          name: "Sandbox inventory",
          kind: "flights",
          connected: true,
          mode: "sandbox",
          detail: "Deterministic test flights for demos and development. Never bookable.",
        },
        {
          code: "duffel",
          name: "Duffel",
          kind: "flights",
          connected: false,
          mode: null,
          detail: "Flight offers from airlines via NDC and GDS. Set TM_DUFFEL_TOKEN.",
        },
        {
          code: "liteapi",
          name: "LiteAPI",
          kind: "hotels",
          connected: false,
          mode: null,
          detail: "Hotel rates worldwide. Set TM_LITEAPI_KEY.",
        },
      ],
    },
    "GET /api/v1/agency": {
      status: 200,
      body: {
        id: "a-alpha",
        name: "Alpha Travels",
        country_code: "IN",
        currency: "INR",
        timezone: "Asia/Kolkata",
        brand_color: "#22d3ee",
        is_demo: false,
        demo_expires_at: null,
      },
    },
  };
}
