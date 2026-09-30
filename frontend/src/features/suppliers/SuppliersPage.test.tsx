import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import type { SupplierHealthResponse } from "../../api/dashboard";
import type { SupplierStatus } from "../../api/offers";
import { ME_AGENT, ME_OWNER } from "../../test/fixtures";
import { mockApi, type MockHandler } from "../../test/mockApi";
import { renderApp, withSession } from "../../test/renderApp";

const SUPPLIERS: SupplierStatus[] = [
  { code: "duffel", name: "Duffel", kind: "flights", connected: true, mode: "test", detail: "Flight offers from airlines via NDC and GDS. Set TM_DUFFEL_TOKEN." },
  { code: "sandbox", name: "Sandbox inventory", kind: "flights", connected: true, mode: "sandbox", detail: "Deterministic test flights for demos and development. Never bookable." },
  { code: "liteapi", name: "LiteAPI", kind: "hotels", connected: false, mode: null, detail: "Hotel rates worldwide. Set TM_LITEAPI_KEY." },
  { code: "google_tim", name: "Google Travel Impact Model", kind: "emissions", connected: true, mode: "live", detail: "Per-flight CO₂ estimates. Set TM_GOOGLE_TIM_API_KEY." },
  { code: "travelpayouts", name: "Travelpayouts", kind: "price_history", connected: false, mode: null, detail: "Cached market prices that seed fare history (indications only). Set TM_TRAVELPAYOUTS_TOKEN." },
  { code: "ecb", name: "ECB reference rates", kind: "exchange_rates", connected: true, mode: "live", detail: "Daily euro reference rates for approximate converted prices." },
];

const HEALTH: SupplierHealthResponse = {
  suppliers: [
    { supplier: "sandbox", kind: "flights", calls: 42, ok: 40, success_pct: 95.2, p50_ms: 180, p95_ms: 420, avg_offers: 12.4 },
    { supplier: "duffel", kind: "flights", calls: 18, ok: 15, success_pct: 83.3, p50_ms: 820, p95_ms: 2100, avg_offers: 38.5 },
  ],
};

function open(me = ME_OWNER, extra: Record<string, MockHandler> = {}) {
  const api = mockApi(
    withSession(me, {
      "GET /api/v1/suppliers": { status: 200, body: SUPPLIERS },
      "GET /api/v1/dashboard/supplier-health": { status: 200, body: HEALTH },
      ...extra,
    }),
  );
  renderApp("/app/suppliers");
  return api;
}

test("booking suppliers and data services are listed separately, each with status and mode", async () => {
  open();
  const booking = await screen.findByRole("table", { name: "Booking suppliers" });
  await within(booking).findByText("Duffel");
  const rows = within(booking).getAllByRole("row").slice(1);
  expect(rows).toHaveLength(3);
  expect(rows[0]).toHaveTextContent("Duffel");
  expect(rows[0]).toHaveTextContent("Flights");
  expect(rows[0]).toHaveTextContent("Connected");
  expect(rows[0]).toHaveTextContent("Test");
  expect(rows[2]).toHaveTextContent("Not connected");
  expect(rows[2]).toHaveTextContent("Set TM_LITEAPI_KEY.");

  const data = screen.getByRole("table", { name: "Data services" });
  const services = within(data).getAllByRole("row").slice(1);
  expect(services.map((r) => r.textContent)).toEqual([
    expect.stringContaining("Google Travel Impact Model"),
    expect.stringContaining("Travelpayouts"),
    expect.stringContaining("ECB reference rates"),
  ]);
  expect(services[0]).toHaveTextContent("CO₂ per passenger on fare results");
  expect(services[1]).toHaveTextContent("Fare insight");
  expect(services[2]).toHaveTextContent("≈ prices converted");
  expect(screen.getByText("4 of 6 connected")).toBeInTheDocument();
});

test("each booking supplier shows its health over the last 24 hours, or that it had no calls", async () => {
  open();
  const booking = await screen.findByRole("table", { name: "Booking suppliers" });
  const sandbox = await within(booking).findByRole("row", { name: /Sandbox inventory/ });
  await within(sandbox).findByText("Healthy");
  expect(sandbox).toHaveTextContent("42 calls · 95.2% ok");
  expect(sandbox).toHaveTextContent("p50 180 ms · p95 420 ms");
  const duffel = within(booking).getByRole("row", { name: /Duffel/ });
  expect(duffel).toHaveTextContent("Degraded");
  expect(duffel).toHaveTextContent("p95 2,100 ms");
  expect(within(booking).getByRole("row", { name: /LiteAPI/ })).toHaveTextContent("No calls in the last 24 h");
});

test("the overview sums calls and success over the last 24 hours", async () => {
  open();
  const overview = await screen.findByRole("region", { name: "Supplier overview" });
  expect(await within(overview).findByRole("group", { name: "Supplier calls, 24 h: 60" })).toBeInTheDocument();
  expect(within(overview).getByRole("group", { name: "Success rate, 24 h: 91.7%" })).toHaveTextContent("Slowest p95 2,100 ms");
  expect(within(overview).getByRole("group", { name: /Booking suppliers: 2 of 3 connected/ })).toBeInTheDocument();
  expect(within(overview).getByRole("group", { name: /Data services: 2 of 3 connected/ })).toBeInTheDocument();
});

test("without health data the tables still load and say so", async () => {
  open(ME_OWNER, { "GET /api/v1/dashboard/supplier-health": { status: 503, body: { detail: "Unavailable." } } });
  const booking = await screen.findByRole("table", { name: "Booking suppliers" });
  const sandbox = await within(booking).findByRole("row", { name: /Sandbox inventory/ });
  expect(await within(sandbox).findByText("Health unavailable")).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Success rate, 24 h: —" })).toBeInTheDocument();
});

test("the sandbox row is findable by name and says it is connected", async () => {
  open(ME_AGENT);
  const table = await screen.findByRole("table", { name: "Booking suppliers" });
  const sandbox = await within(table).findByRole("row", { name: /Sandbox inventory/ });
  expect(sandbox).toHaveTextContent("Connected");
  expect(sandbox).toHaveTextContent("Sandbox");
});

test("a failed supplier check shows the reason", async () => {
  open(ME_OWNER, { "GET /api/v1/suppliers": { status: 503, body: { detail: "Supplier status is unavailable." } } });
  expect(await screen.findByRole("alert")).toHaveTextContent("Supplier status is unavailable.");
});

test("each connection shows how to set it up and links to the provider's docs", async () => {
  open();
  const table = await screen.findByRole("table", { name: "Booking suppliers" });
  const duffel = await within(table).findByRole("row", { name: /Duffel/ });
  expect(within(duffel).getByText("TM_DUFFEL_TOKEN")).toBeInTheDocument();
  expect(within(duffel).getByRole("link", { name: /Duffel docs/ })).toHaveAttribute("href", "https://duffel.com/docs");
  const sandbox = within(table).getByRole("row", { name: /Sandbox inventory/ });
  expect(within(sandbox).getByText("TM_SANDBOX_SUPPLIER")).toBeInTheDocument();
  const ecb = within(screen.getByRole("table", { name: "Data services" })).getByRole("row", { name: /ECB reference rates/ });
  expect(within(ecb).getByText("TM_FX_ENABLED")).toBeInTheDocument();
});

test("the modes panel explains live, test and sandbox", async () => {
  open();
  const modes = await screen.findByRole("region", { name: "Modes" });
  expect(modes).toHaveTextContent("Live");
  expect(modes).toHaveTextContent("A provider's test keys");
  expect(modes).toHaveTextContent("Never bookable");
});
