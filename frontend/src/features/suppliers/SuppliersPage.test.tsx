import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import type { SupplierStatus } from "../../api/offers";
import { ME_AGENT, ME_OWNER } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { renderApp, withSession } from "../../test/renderApp";

const SUPPLIERS: SupplierStatus[] = [
  { code: "duffel", name: "Duffel", kind: "flights", connected: true, mode: "test", detail: "Flight offers from airlines via NDC and GDS. Set TM_DUFFEL_TOKEN." },
  { code: "sandbox", name: "Sandbox inventory", kind: "flights", connected: true, mode: "sandbox", detail: "Deterministic test flights for demos and development. Never bookable." },
  { code: "liteapi", name: "LiteAPI", kind: "hotels", connected: false, mode: null, detail: "Hotel rates worldwide. Set TM_LITEAPI_KEY." },
];

test("the suppliers page shows each connection and its mode", async () => {
  mockApi(withSession(ME_OWNER, { "GET /api/v1/suppliers": { status: 200, body: SUPPLIERS } }));
  renderApp("/suppliers");
  const table = await screen.findByRole("table", { name: "Supplier connections" });
  const rows = within(table).getAllByRole("row").slice(1);
  expect(rows).toHaveLength(3);
  expect(rows[0]).toHaveTextContent("Duffel");
  expect(rows[0]).toHaveTextContent("Flights");
  expect(rows[0]).toHaveTextContent("Connected");
  expect(rows[0]).toHaveTextContent("Test");
  expect(rows[2]).toHaveTextContent("Not connected");
  expect(rows[2]).toHaveTextContent("Set TM_LITEAPI_KEY.");
});

test("the sandbox row is findable by name and says it is connected", async () => {
  mockApi(withSession(ME_AGENT, { "GET /api/v1/suppliers": { status: 200, body: SUPPLIERS } }));
  renderApp("/suppliers");
  const table = await screen.findByRole("table", { name: "Supplier connections" });
  const sandbox = within(table).getByRole("row", { name: /Sandbox inventory/ });
  expect(sandbox).toHaveTextContent("Connected");
  expect(sandbox).toHaveTextContent("Sandbox");
});

test("a failed supplier check shows the reason", async () => {
  mockApi(withSession(ME_OWNER, { "GET /api/v1/suppliers": { status: 503, body: { detail: "Supplier status is unavailable." } } }));
  renderApp("/suppliers");
  expect(await screen.findByRole("alert")).toHaveTextContent("Supplier status is unavailable.");
});
