import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import type { HotelOffer, HotelSearchResponse } from "../../api/offers";
import { isoDateFromNow } from "../../lib/dates";
import { AIRPORTS, ME_OWNER } from "../../test/fixtures";
import { mockApi, type MockHandler } from "../../test/mockApi";
import { renderApp, withSession } from "../../test/renderApp";
import { recordRecentRoute } from "../route/recentRoutes";
import { routeStore } from "../route/routeStore";

const SEARCH = "POST /api/v1/hotels/search";

function hotel(overrides: Partial<HotelOffer>): HotelOffer {
  return {
    id: "liteapi~offer-1",
    supplier: "liteapi",
    provenance: "SANDBOX",
    hotel_id: "lp1",
    name: "Harbour View Mumbai",
    stars: 5,
    rating: 8.9,
    address: "12 Marine Drive, Mumbai",
    photo_url: null,
    room_name: "Deluxe King Room",
    board: "Bed & Breakfast",
    total: { amount_minor: 942000, currency: "INR" },
    refundable: true,
    free_cancellation_until: "2026-11-18 12:00:00 GMT",
    nights: 2,
    fetched_at: "2026-09-29T10:00:00Z",
    display_total: { amount_minor: 942000, currency: "INR" },
    ...overrides,
  };
}

function response(overrides: Partial<HotelSearchResponse>): HotelSearchResponse {
  return {
    display_currency: "INR",
    fx_as_of: null,
    nights: 2,
    sources: [{ supplier: "liteapi", status: "ok", offer_count: 1, latency_ms: 800, message: null }],
    offers: [hotel({})],
    ...overrides,
  };
}

function open(extra: Record<string, MockHandler>) {
  const api = mockApi(withSession(ME_OWNER, extra));
  return { ...api, ...renderApp("/app/hotels") };
}

async function scanAndList(extra: Record<string, MockHandler>) {
  const view = open(extra);
  await view.user.click(await screen.findByRole("button", { name: "Scan hotels" }));
  const list = await screen.findByRole("list", { name: "Hotel offers" });
  return { ...view, list };
}

beforeEach(() => routeStore.set({ origin: AIRPORTS.DEL, destination: AIRPORTS.BOM }));

test("the destination comes from the route and hotels are listed with terms", async () => {
  const { calls } = mockApi(withSession(ME_OWNER, { [SEARCH]: { status: 200, body: response({}) } }));
  const { user } = renderApp("/app/hotels");
  await user.click(await screen.findByRole("button", { name: "Scan hotels" }));
  const list = await screen.findByRole("list", { name: "Hotel offers" });
  const [card] = within(list).getAllByRole("article");
  expect(card).toHaveAccessibleName("Harbour View Mumbai ₹9,420");
  expect(card).toHaveTextContent("₹4,710 / night");
  expect(card).toHaveTextContent("Deluxe King Room · Bed & Breakfast");
  expect(card).toHaveTextContent("Free cancellation until 2026-11-18 12:00:00 GMT");
  expect(card).toHaveTextContent("8.9");
  expect(calls.find((c) => c.path === "/api/v1/hotels/search")?.body).toEqual({
    destination: "BOM",
    checkin: isoDateFromNow(14),
    checkout: isoDateFromNow(16),
    rooms: [{ adults: 2, children_ages: [] }],
  });
});

test("without a hotel supplier the page says how to connect one", async () => {
  mockApi(
    withSession(ME_OWNER, {
      [SEARCH]: {
        status: 200,
        body: response({
          offers: [],
          sources: [{ supplier: "liteapi", status: "not_configured", offer_count: 0, latency_ms: 0, message: "Connect LiteAPI (TM_LITEAPI_KEY) to see hotels." }],
        }),
      },
    }),
  );
  const { user } = renderApp("/app/hotels");
  await user.click(await screen.findByRole("button", { name: "Scan hotels" }));
  expect(await screen.findByText("Connect LiteAPI (TM_LITEAPI_KEY) to see hotels.", { selector: "p" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open suppliers" })).toHaveAttribute("href", "/app/suppliers");
});

test("an unconnected supplier doesn't hide rooms another supplier found", async () => {
  const { list } = await scanAndList({
    [SEARCH]: {
      status: 200,
      body: response({
        sources: [
          { supplier: "liteapi", status: "ok", offer_count: 1, latency_ms: 800, message: null },
          { supplier: "hotelbeds", status: "not_configured", offer_count: 0, latency_ms: 0, message: "Connect Hotelbeds to see more hotels." },
        ],
      }),
    },
  });
  expect(within(list).getAllByRole("article")).toHaveLength(1);
  expect(screen.getByText("Connect Hotelbeds to see more hotels.", { selector: "p" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open suppliers" })).toBeInTheDocument();
});

test("a converted price is marked approximate and shows what is billed", async () => {
  const converted = hotel({
    provenance: "LIVE",
    total: { amount_minor: 20000, currency: "USD" },
    display_total: { amount_minor: 1666000, currency: "INR" },
  });
  const { list } = await scanAndList({ [SEARCH]: { status: 200, body: response({ offers: [converted], fx_as_of: "2026-09-28" }) } });
  const card = within(list).getByRole("article");
  expect(card).toHaveAccessibleName("Harbour View Mumbai about ₹16,660");
  expect(card).toHaveTextContent("≈ ₹16,660");
  expect(card).toHaveTextContent("Billed $200");
  expect(card).toHaveTextContent("≈ ₹8,330 / night");
  expect(card).toHaveTextContent("Live");
  expect(screen.getByText(/ECB reference rates of 2026-09-28/)).toBeInTheDocument();
});

test("cached hotel prices are labelled indicative, like cached fares", async () => {
  const { list } = await scanAndList({ [SEARCH]: { status: 200, body: response({ offers: [hotel({ provenance: "CACHED" })] }) } });
  expect(within(list).getByRole("article")).toHaveTextContent("Cached · indicative");
});

test("an unconverted price is shown as billed, without ≈", async () => {
  const unconverted = hotel({ total: { amount_minor: 20000, currency: "USD" }, display_total: null });
  const { list } = await scanAndList({ [SEARCH]: { status: 200, body: response({ offers: [unconverted] }) } });
  const card = within(list).getByRole("article");
  expect(card).toHaveAccessibleName("Harbour View Mumbai $200");
  expect(card).not.toHaveTextContent("≈");
  expect(card).not.toHaveTextContent("Billed");
  expect(card).toHaveTextContent("Sandbox · not bookable");
});

test("cancellation terms are never overstated", async () => {
  const { list } = await scanAndList({
    [SEARCH]: {
      status: 200,
      body: response({
        offers: [
          hotel({ id: "a", name: "Non Ref Inn", refundable: false, free_cancellation_until: null }),
          hotel({ id: "b", name: "Unknown Terms Lodge", refundable: null, free_cancellation_until: null, rating: null, stars: null }),
          hotel({ id: "c", name: "Flexible Suites", refundable: true, free_cancellation_until: null }),
        ],
      }),
    },
  });
  const [nonRef, unknown, flexible] = within(list).getAllByRole("article");
  expect(nonRef).toHaveTextContent("Non-refundable");
  expect(unknown).toHaveTextContent("Cancellation terms on request");
  expect(unknown).toHaveTextContent("No rating yet");
  expect(flexible).toHaveTextContent("Refundable");
  expect(flexible).not.toHaveTextContent("Free cancellation");
});

test("star ratings are read as a number, not a row of symbols", async () => {
  const { list } = await scanAndList({ [SEARCH]: { status: 200, body: response({ offers: [hotel({ stars: 4 })] }) } });
  expect(within(list).getByText("4-star hotel")).toBeInTheDocument();
});

test("a rate-limited scan shows the reason", async () => {
  const { user } = open({ [SEARCH]: { status: 429, body: { detail: "Too many searches. Try again in a minute." } } });
  await user.click(await screen.findByRole("button", { name: "Scan hotels" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Too many searches. Try again in a minute.");
});

test("an empty board is explained", async () => {
  const { user } = open({ [SEARCH]: { status: 200, body: response({ offers: [] }) } });
  await user.click(await screen.findByRole("button", { name: "Scan hotels" }));
  expect(await screen.findByText("No rooms for these dates.")).toBeInTheDocument();
});

test("adults can be cleared and retyped, and are clamped when the field is left", async () => {
  const { user, calls } = open({ [SEARCH]: { status: 200, body: response({}) } });
  const adults = await screen.findByRole("spinbutton", { name: "Adults" });
  await user.clear(adults);
  expect(adults).toHaveValue(null);
  await user.type(adults, "3");
  expect(adults).toHaveValue(3);
  await user.click(screen.getByRole("button", { name: "Scan hotels" }));
  await screen.findByRole("list", { name: "Hotel offers" });
  expect(calls.find((c) => c.path === "/api/v1/hotels/search")?.body).toMatchObject({ rooms: [{ adults: 3, children_ages: [] }] });

  await user.clear(adults);
  await user.type(adults, "42");
  await user.tab();
  expect(adults).toHaveValue(6);
  await user.clear(adults);
  await user.tab();
  expect(adults).toHaveValue(1);
});

test("an empty adults field is sent as one guest", async () => {
  const { user, calls } = open({ [SEARCH]: { status: 200, body: response({}) } });
  const adults = await screen.findByRole("spinbutton", { name: "Adults" });
  await user.clear(adults);
  fireEvent.submit(adults.closest("form")!);
  await screen.findByRole("list", { name: "Hotel offers" });
  expect(calls.find((c) => c.path === "/api/v1/hotels/search")?.body).toMatchObject({ rooms: [{ adults: 1, children_ages: [] }] });
  expect(adults).toHaveValue(1);
});

test("a check-in in the past can't be scanned", async () => {
  open({});
  const checkin = await screen.findByLabelText("Check-in");
  fireEvent.change(checkin, { target: { value: isoDateFromNow(-1) } });
  expect(checkin).toHaveAccessibleDescription("Check-in can't be in the past.");
  expect(screen.getByRole("button", { name: "Scan hotels" })).toBeDisabled();
});

test("check-out must come after check-in", async () => {
  open({});
  const checkout = await screen.findByLabelText("Check-out");
  fireEvent.change(checkout, { target: { value: isoDateFromNow(14) } });
  expect(checkout).toHaveAccessibleDescription("Check-out must be after check-in.");
  expect(screen.getByRole("button", { name: "Scan hotels" })).toBeDisabled();
});

test("the scan waits for a destination", async () => {
  routeStore.reset();
  open({});
  expect(await screen.findByRole("button", { name: "Scan hotels" })).toBeDisabled();
});

test("the results header summarises the stay and reports each supplier", async () => {
  await scanAndList({ [SEARCH]: { status: 200, body: response({}) } });
  const results = screen.getByRole("region", { name: /Results/ });
  expect(results).toHaveTextContent("1 hotel");
  expect(results).toHaveTextContent("Near BOM");
  expect(results).toHaveTextContent("2 adults, 1 room");
  expect(within(results).getByRole("list", { name: "Supplier status" })).toHaveTextContent("liteapi · OK");
});

test("before a search, destinations from recent fare searches come first, then labelled suggestions", async () => {
  routeStore.reset();
  recordRecentRoute(ME_OWNER.user.id, AIRPORTS.DEL, AIRPORTS.LHR);
  recordRecentRoute(ME_OWNER.user.id, AIRPORTS.DEL, AIRPORTS.BOM);
  const { user } = open({});
  const recent = await screen.findByRole("list", { name: "From your recent fare searches" });
  expect(within(recent).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
    "Near BOM, Mumbai",
    "Near LHR, London",
  ]);
  const popular = screen.getByRole("list", { name: "Popular destinations" });
  expect(screen.getByText("Suggested, not from your searches")).toBeInTheDocument();
  expect(within(popular).getAllByRole("button")).toHaveLength(6);
  expect(within(popular).queryByRole("button", { name: /^Near BOM/ })).not.toBeInTheDocument();

  expect(screen.getByRole("button", { name: "Scan hotels" })).toBeDisabled();
  await user.click(within(popular).getByRole("button", { name: "Near GOI, Goa" }));
  expect(within(popular).getByRole("button", { name: "Near GOI, Goa" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Scan hotels" })).toBeEnabled();
});

test("check-out shows the number of nights", async () => {
  open({});
  const checkout = await screen.findByLabelText("Check-out");
  expect(checkout).toHaveAccessibleDescription("2 nights");
  fireEvent.change(checkout, { target: { value: isoDateFromNow(15) } });
  expect(checkout).toHaveAccessibleDescription("1 night");
});

test("supplier status lists hotel suppliers and exchange rates only", async () => {
  open({
    "GET /api/v1/suppliers": {
      status: 200,
      body: [
        { code: "sandbox", name: "Sandbox inventory", kind: "flights", connected: true, mode: "sandbox", detail: "Test flights." },
        { code: "liteapi", name: "LiteAPI", kind: "hotels", connected: false, mode: null, detail: "Hotel rates worldwide. Set TM_LITEAPI_KEY." },
        { code: "ecb", name: "ECB reference rates", kind: "exchange_rates", connected: true, mode: "live", detail: "Daily euro reference rates." },
      ],
    },
    "GET /api/v1/dashboard/supplier-health": { status: 200, body: { suppliers: [] } },
  });
  const card = await screen.findByRole("region", { name: "Supplier status" });
  const hotels = await within(card).findByRole("list", { name: "Hotel suppliers" });
  expect(within(hotels).getAllByRole("listitem")).toHaveLength(1);
  expect(hotels).toHaveTextContent("LiteAPI");
  expect(hotels).toHaveTextContent("Not connected");
  expect(within(card).getByRole("list", { name: "Data in results" })).toHaveTextContent("ECB reference rates");
  expect(card).not.toHaveTextContent("Sandbox inventory");
  expect(card).toHaveTextContent("No hotels supplier is connected, so a search returns no offers.");
});

test("the reading guide explains prices and cancellation terms", async () => {
  open({});
  const guide = await screen.findByRole("region", { name: "How to read results" });
  expect(within(guide).getByRole("region", { name: "Prices" })).toHaveTextContent("The stay total divided by the number of nights.");
  expect(within(guide).getByRole("region", { name: "Cancellation terms" })).toHaveTextContent("Cancellation terms on request");
});
