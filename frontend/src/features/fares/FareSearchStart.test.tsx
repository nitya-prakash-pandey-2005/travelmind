import { screen, within } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import type { SupplierHealthResponse } from "../../api/dashboard";
import type { SupplierStatus } from "../../api/offers";
import { AIRPORTS, ME_OWNER } from "../../test/fixtures";
import { mockApi, type MockHandler } from "../../test/mockApi";
import { searchResponse } from "../../test/offerFixtures";
import { renderApp, withSession } from "../../test/renderApp";
import { loadRecentRoutes, recordRecentRoute } from "../route/recentRoutes";
import { routeStore } from "../route/routeStore";
import { POPULAR_ROUTES } from "./popularRoutes";
import { quickRoutes } from "./QuickRoutes";

const SUPPLIERS: SupplierStatus[] = [
  { code: "duffel", name: "Duffel", kind: "flights", connected: false, mode: null, detail: "Flight offers from airlines via NDC and GDS. Set TM_DUFFEL_TOKEN." },
  { code: "sandbox", name: "Sandbox inventory", kind: "flights", connected: true, mode: "sandbox", detail: "Deterministic test flights." },
  { code: "liteapi", name: "LiteAPI", kind: "hotels", connected: true, mode: "test", detail: "Hotel rates worldwide. Set TM_LITEAPI_KEY." },
  { code: "google_tim", name: "Google Travel Impact Model", kind: "emissions", connected: true, mode: "live", detail: "Per-flight CO₂ estimates. Set TM_GOOGLE_TIM_API_KEY." },
  { code: "ecb", name: "ECB reference rates", kind: "exchange_rates", connected: true, mode: "live", detail: "Daily euro reference rates." },
];

const HEALTH: SupplierHealthResponse = {
  suppliers: [{ supplier: "sandbox", kind: "flights", calls: 42, ok: 40, success_pct: 95.2, p50_ms: 180, p95_ms: 420, avg_offers: 12.4 }],
};

function open(extra: Record<string, MockHandler> = {}) {
  const api = mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/suppliers": { status: 200, body: SUPPLIERS },
      "GET /api/v1/dashboard/supplier-health": { status: 200, body: HEALTH },
      ...extra,
    }),
  );
  return { ...api, ...renderApp("/app/fares") };
}

beforeEach(() => routeStore.reset());

test("before any search, popular routes are offered and labelled as suggestions", async () => {
  const { user } = open();
  const popular = await screen.findByRole("list", { name: "Popular routes" });
  expect(screen.getByText("Suggested busy routes, not from your searches")).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Your recent searches" })).not.toBeInTheDocument();
  expect(within(popular).getAllByRole("button")).toHaveLength(8);

  await user.click(within(popular).getByRole("button", { name: /^DEL to BOM/ }));
  expect(routeStore.get().origin?.iata_code).toBe("DEL");
  expect(routeStore.get().destination?.iata_code).toBe("BOM");
  expect(within(popular).getByRole("button", { name: /^DEL to BOM/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Scan fares" })).toBeEnabled();
});

test("each quick route shows its great-circle distance", async () => {
  open();
  const popular = await screen.findByRole("list", { name: "Popular routes" });
  expect(within(popular).getByRole("button", { name: /^DEL to BOM/ })).toHaveTextContent("1,138 km");
});

test("recent searches come first and popular routes fill the rest", async () => {
  recordRecentRoute(ME_OWNER.user.id, AIRPORTS.DEL, AIRPORTS.BOM);
  recordRecentRoute(ME_OWNER.user.id, AIRPORTS.BOM, AIRPORTS.LHR);
  open();
  const recent = await screen.findByRole("list", { name: "Your recent searches" });
  const chips = within(recent).getAllByRole("button");
  expect(chips.map((c) => c.getAttribute("aria-label")?.slice(0, 10))).toEqual(["BOM to LHR", "DEL to BOM"]);
  const popular = screen.getByRole("list", { name: "Popular routes" });
  expect(within(popular).getAllByRole("button")).toHaveLength(6);
  expect(within(popular).queryByRole("button", { name: /^DEL to BOM/ })).not.toBeInTheDocument();
});

test("a scan remembers the route for next time", async () => {
  routeStore.set({ origin: AIRPORTS.DEL, destination: AIRPORTS.GOI });
  const { user } = open({ "POST /api/v1/flights/search": { status: 200, body: searchResponse() } });
  await user.click(await screen.findByRole("button", { name: "Scan fares" }));
  await screen.findByRole("region", { name: /Results/ });
  expect(loadRecentRoutes(ME_OWNER.user.id).map((r) => `${r.origin.iata_code}-${r.destination.iata_code}`)).toEqual(["DEL-GOI"]);
  expect(screen.queryByRole("region", { name: "Quick routes" })).not.toBeInTheDocument();
});

test("supplier status lists flight suppliers with mode and 24 h health, and the data added to results", async () => {
  open();
  const card = await screen.findByRole("region", { name: "Supplier status" });
  const flights = await within(card).findByRole("list", { name: "Flight suppliers" });
  const rows = within(flights).getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent("Duffel");
  expect(rows[0]).toHaveTextContent("Not connected");
  expect(rows[1]).toHaveTextContent("Sandbox inventory");
  expect(rows[1]).toHaveTextContent("Sandbox");
  await within(rows[1]!).findByText(/42 calls · 95\.2% ok/);
  expect(rows[1]).toHaveTextContent("p50 180 ms · p95 420 ms (24 h)");
  expect(card).toHaveTextContent("1 of 2 connected");

  const data = within(card).getByRole("list", { name: "Data in results" });
  expect(within(data).getAllByRole("listitem").map((r) => r.textContent)).toEqual([
    expect.stringContaining("Google Travel Impact Model"),
    expect.stringContaining("ECB reference rates"),
  ]);
  expect(card).not.toHaveTextContent("LiteAPI");
  expect(within(card).getByRole("link", { name: "Manage suppliers" })).toHaveAttribute("href", "/app/suppliers");
});

test("without a connected flight supplier, supplier status warns that a scan finds nothing", async () => {
  open({ "GET /api/v1/suppliers": { status: 200, body: SUPPLIERS.map((s) => ({ ...s, connected: false, mode: null })) } });
  const card = await screen.findByRole("region", { name: "Supplier status" });
  expect(await within(card).findByText(/No flights supplier is connected/)).toBeInTheDocument();
});

test("a failed supplier check says so in the card", async () => {
  open({ "GET /api/v1/suppliers": { status: 503, body: { detail: "Supplier status is unavailable." } } });
  const card = await screen.findByRole("region", { name: "Supplier status" });
  expect(await within(card).findByText(/Couldn't load supplier status\. Supplier status is unavailable\./)).toBeInTheDocument();
});

test("the reading guide explains provenance, fare insight and CO₂ sources", async () => {
  open();
  const guide = await screen.findByRole("region", { name: "How to read results" });
  expect(within(guide).getByRole("region", { name: "Where the price comes from" })).toHaveTextContent("Sandbox · not bookable");
  expect(within(guide).getByRole("region", { name: "Fare insight" })).toHaveTextContent("Below the 25th percentile");
  expect(within(guide).getByRole("region", { name: "CO₂ per passenger" })).toHaveTextContent("route typical");
});

test("quick routes never repeat a route and never exceed eight", () => {
  const recent = POPULAR_ROUTES.slice(0, 3);
  const { recent: mine, popular } = quickRoutes(recent);
  expect(mine).toHaveLength(3);
  expect(popular).toHaveLength(5);
  const keys = [...mine, ...popular].map((p) => `${p.origin.iata_code}-${p.destination.iata_code}`);
  expect(new Set(keys).size).toBe(8);

  const many = Array.from({ length: 10 }, (_, i) => ({ origin: AIRPORTS.DEL, destination: { ...AIRPORTS.BOM, iata_code: `X${i}` } }));
  expect(quickRoutes(many)).toEqual({ recent: many.slice(0, 8), popular: [] });
});
