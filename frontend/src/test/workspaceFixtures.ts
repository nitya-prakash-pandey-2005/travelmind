import type { MockHandler } from "./mockApi";

/** An empty agency: every KPI at zero (win rate and response time have no value yet), zero-filled series. */
const RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

function emptySeries(days: number): { date: string; value: number }[] {
  const today = new Date();
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(today);
    day.setUTCDate(today.getUTCDate() - (days - 1 - index));
    return { date: day.toISOString().slice(0, 10), value: 0 };
  });
}

const KPIS = [
  { key: "open_enquiries", label: "Open enquiries", unit: "count", empty: 0 },
  { key: "quotes_sent", label: "Quotes sent", unit: "count", empty: 0 },
  { key: "win_rate", label: "Win rate", unit: "percent", empty: null },
  { key: "pipeline_value", label: "Pipeline value", unit: "money", empty: 0 },
  { key: "response_time", label: "Response time", unit: "minutes", empty: null },
  { key: "co2_quoted", label: "CO₂ quoted", unit: "kg", empty: 0 },
  { key: "searches", label: "Searches", unit: "count", empty: 0 },
] as const;

const ONBOARDING_ITEMS = [
  { key: "profile", label: "Add your agency details", href: "/app/settings" },
  { key: "supplier", label: "Connect a live supplier", href: "/app/suppliers" },
  { key: "team", label: "Invite a teammate", href: "/app/team" },
  { key: "fare_scan", label: "Run your first fare scan", href: "/app/fares" },
  { key: "client", label: "Add a client", href: "/app" },
  { key: "quote", label: "Send your first quote", href: "/app" },
] as const;

/**
 * API responses for everything the app shell and the Command Center request, shaped exactly like the
 * backend's (see the dashboard, notifications, onboarding and search schemas). Test-only.
 * This version describes a brand-new, empty workspace.
 */
export function commandCenterMocks(): Record<string, MockHandler> {
  return {
    "GET /api/v1/dashboard/summary": (call) => {
      const range = call.search.get("range") ?? "30d";
      const days = RANGE_DAYS[range] ?? 30;
      return {
        status: 200,
        body: {
          range,
          currency: "INR",
          kpis: KPIS.map(({ key, label, unit, empty }) => ({
            key,
            label,
            value: empty,
            unit,
            previous: key === "pipeline_value" ? null : empty,
            series: emptySeries(days),
          })),
        },
      };
    },
    "GET /api/v1/dashboard/pipeline": {
      status: 200,
      body: {
        currency: "INR",
        stages: (["new", "quoting", "quoted", "won", "lost"] as const).map((status) => ({
          status,
          count: 0,
          value_minor: 0,
        })),
      },
    },
    "GET /api/v1/dashboard/activity": { status: 200, body: { items: [] } },
    "GET /api/v1/dashboard/market-pulse": { status: 200, body: { currency: "INR", routes: [] } },
    "GET /api/v1/dashboard/supplier-health": { status: 200, body: { suppliers: [] } },
    "GET /api/v1/dashboard/team": {
      status: 200,
      body: {
        members: [
          {
            user: { id: "u-owner", full_name: "Asha Rao", role: "owner" },
            enquiries: 0,
            quotes_sent: 0,
            won_value_minor: 0,
          },
        ],
      },
    },
    "GET /api/v1/dashboard/departures": { status: 200, body: { items: [] } },
    "GET /api/v1/onboarding": {
      status: 200,
      body: { items: ONBOARDING_ITEMS.map((item) => ({ ...item, done: false })), completed: 0, total: 6 },
    },
    "GET /api/v1/notifications": { status: 200, body: { unread: 0, items: [] } },
    "POST /api/v1/notifications/seen": { status: 204 },
    "GET /api/v1/search": { status: 200, body: { clients: [], enquiries: [], quotes: [] } },
    "GET /api/v1/enquiries": { status: 200, body: { items: [], total: 0 } },
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
