import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { resetSessionState } from "../../auth/resetSessionState";
import { isoDateFromNow } from "../../lib/dates";
import { AIRPORTS, ME_OWNER } from "../../test/fixtures";
import { mockApi, type MockHandler } from "../../test/mockApi";
import { makeOffer, searchResponse, segment } from "../../test/offerFixtures";
import { renderApp, withSession } from "../../test/renderApp";
import { routeStore } from "../route/routeStore";

const SEARCH = "POST /api/v1/flights/search";
const inr = (amount_minor: number) => ({ amount_minor, currency: "INR" });

const indigo = makeOffer({ id: "sandbox~a", total: inr(420000), display_total: inr(420000), total_duration_minutes: 200 });
const airIndia = makeOffer({
  id: "sandbox~b",
  owner_carrier: "AI",
  owner_name: "Air India",
  total: inr(610000),
  display_total: inr(610000),
  total_duration_minutes: 130,
});

function scan(extra: Record<string, MockHandler>) {
  const api = mockApi(withSession(ME_OWNER, extra));
  const view = renderApp("/fares");
  return { ...api, ...view };
}

async function scanAndList(extra: Record<string, MockHandler>) {
  const view = scan(extra);
  await view.user.click(await screen.findByRole("button", { name: "Scan fares" }));
  const list = await screen.findByRole("list", { name: "Flight offers" });
  return { ...view, list };
}

beforeEach(() => routeStore.set({ origin: AIRPORTS.DEL, destination: AIRPORTS.BOM }));

test("scanning sends the trip and lists offers cheapest first", async () => {
  const { list, calls } = await scanAndList({ [SEARCH]: { status: 200, body: searchResponse({ offers: [indigo, airIndia] }) } });
  const cards = within(list).getAllByRole("article");
  expect(cards).toHaveLength(2);
  expect(cards[0]).toHaveAccessibleName("IndiGo ₹4,200");
  expect(cards[0]).toHaveTextContent("06:10");
  expect(cards[0]).toHaveTextContent("Nonstop");
  expect(calls.find((c) => c.path === "/api/v1/flights/search")?.body).toEqual({
    origin: "DEL",
    destination: "BOM",
    departure_date: isoDateFromNow(14),
    return_date: null,
    adults: 1,
    children_ages: [],
    cabin: "economy",
    max_connections: 1,
  });
});

test("the scan button waits for two different airports", async () => {
  routeStore.set({ origin: AIRPORTS.DEL, destination: null });
  scan({});
  expect(await screen.findByRole("button", { name: "Scan fares" })).toBeDisabled();
});

test("offers show provenance, stops, CO₂ and converted prices", async () => {
  const london = makeOffer({
    id: "duffel~off_1",
    supplier: "duffel",
    provenance: "LIVE",
    owner_carrier: "EK",
    owner_name: "Emirates",
    total: { amount_minor: 10000, currency: "USD" },
    display_total: inr(833100),
    co2_kg_per_passenger: 240,
    co2_source: "google_tim_typical",
    slices: [
      {
        origin: "DEL",
        destination: "BOM",
        duration_minutes: 610,
        fare_brand: null,
        segments: [
          segment("DEL", "DXB", "2026-11-20T22:00:00", "2026-11-21T00:30:00", "EK", "511"),
          segment("DXB", "BOM", "2026-11-21T03:00:00", "2026-11-21T07:40:00", "EK", "500"),
        ],
        stops: 1,
      },
    ],
    stops: 1,
  });
  const { list } = await scanAndList({ [SEARCH]: { status: 200, body: searchResponse({ offers: [indigo, london] }) } });
  const [sandboxCard, liveCard] = within(list).getAllByRole("article");
  expect(sandboxCard).toHaveTextContent("Sandbox · not bookable");
  expect(liveCard).toHaveTextContent("Live");
  expect(liveCard).toHaveTextContent("≈ ₹8,331");
  expect(liveCard).toHaveTextContent("Billed $100");
  expect(liveCard).toHaveTextContent("1 stop · DXB");
  expect(liveCard).toHaveTextContent("+1");
  expect(liveCard).toHaveTextContent("240 kg CO₂e");
  expect(liveCard).toHaveTextContent("240 kg CO₂e · route typical");
  expect(sandboxCard).toHaveTextContent("98 kg CO₂e · this flight");
  expect(liveCard).toHaveAccessibleName("Emirates about ₹8,331");
  expect(sandboxCard).toHaveAccessibleName("IndiGo ₹4,200");
  expect(screen.getByText(/Google Travel Impact Model/)).toBeInTheDocument();
});

test("every supplier's outcome is reported", async () => {
  await scanAndList({
    [SEARCH]: {
      status: 200,
      body: searchResponse({
        sources: [
          { supplier: "sandbox", status: "ok", offer_count: 1, latency_ms: 12, message: null },
          { supplier: "duffel", status: "timeout", offer_count: 0, latency_ms: 25000, message: "No answer within 25s." },
        ],
      }),
    },
  });
  const sweep = screen.getByRole("list", { name: "Supplier sweep" });
  expect(sweep).toHaveTextContent("sandbox · OK");
  expect(sweep).toHaveTextContent("1 offer · 12 ms");
  expect(sweep).toHaveTextContent("duffel · Timeout");
  expect(sweep).toHaveTextContent("No answer within 25s.");
});

test("the price check compares the cheapest fare with the route's history", async () => {
  const good = { ...indigo, insight: { signal: "good" as const, delta_pct: -19.2, message: "19% under the median of 24 fares seen for this route. Good time to book." } };
  await scanAndList({
    [SEARCH]: {
      status: 200,
      body: searchResponse({
        baseline: { family: "market", currency: "INR", sample_size: 24, p25_minor: 450000, median_minor: 520000, p75_minor: 600000, window_days: 45 },
        offers: [good],
      }),
    },
  });
  const check = screen.getByRole("region", { name: "Price check" });
  expect(within(check).getByText("₹5,200")).toBeInTheDocument();
  expect(within(check).getByText(/Good time to book/)).toBeInTheDocument();
  expect(within(check).getByRole("img", { name: /Cheapest fare ₹4,200 against a typical range of ₹4,500 to ₹6,000/ })).toBeInTheDocument();
  expect(screen.getAllByRole("article")[0]).toHaveTextContent("Good price");
});

test("a fare in another currency is never placed on the gauge", async () => {
  const unconverted = { ...indigo, total: { amount_minor: 10000, currency: "USD" }, display_total: { amount_minor: 10000, currency: "USD" } };
  await scanAndList({
    [SEARCH]: {
      status: 200,
      body: searchResponse({
        baseline: { family: "market", currency: "INR", sample_size: 24, p25_minor: 450000, median_minor: 520000, p75_minor: 600000, window_days: 45 },
        offers: [unconverted],
      }),
    },
  });
  const check = screen.getByRole("region", { name: "Price check" });
  expect(within(check).getByRole("img", { name: "Fares on this route usually fall in a typical range of ₹4,500 to ₹6,000" })).toBeInTheDocument();
});

test("sandbox history is labelled as such", async () => {
  await scanAndList({
    [SEARCH]: {
      status: 200,
      body: searchResponse({
        baseline: { family: "sandbox", currency: "INR", sample_size: 12, p25_minor: 450000, median_minor: 520000, p75_minor: 600000, window_days: 45 },
      }),
    },
  });
  expect(screen.getByRole("region", { name: "Price check" })).toHaveTextContent("Built from sandbox searches");
});

test("fastest re-sorts the board", async () => {
  const { list, user } = await scanAndList({ [SEARCH]: { status: 200, body: searchResponse({ offers: [indigo, airIndia] }) } });
  expect(screen.getByRole("group", { name: "Sort offers" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Fastest" }));
  expect(screen.getByRole("button", { name: "Fastest" })).toHaveAttribute("aria-pressed", "true");
  expect(within(list).getAllByRole("article")[0]).toHaveAccessibleName("Air India ₹6,100");
});

test("verifying a price confirms it or shows the new one", async () => {
  const { list, user } = await scanAndList({
    [SEARCH]: { status: 200, body: searchResponse({ offers: [indigo, airIndia] }) },
    "POST /api/v1/flights/offers/sandbox~a/price": {
      status: 200,
      body: { offer: indigo, price_changed: false, previous_total: indigo.total },
    },
    "POST /api/v1/flights/offers/sandbox~b/price": {
      status: 200,
      body: { offer: { ...airIndia, total: inr(650000) }, price_changed: true, previous_total: airIndia.total },
    },
  });
  const first = within(list).getByRole("article", { name: "IndiGo ₹4,200" });
  const second = within(list).getByRole("article", { name: "Air India ₹6,100" });
  await user.click(within(first).getByRole("button", { name: "Verify price" }));
  expect(await within(first).findByText(/Price confirmed/)).toBeInTheDocument();
  await user.click(within(second).getByRole("button", { name: "Verify price" }));
  expect(await within(second).findByText("Price changed · now ₹6,500 (was ₹6,100)")).toBeInTheDocument();
});

test("an expired offer says so", async () => {
  const { list, user } = await scanAndList({
    [SEARCH]: { status: 200, body: searchResponse({ offers: [indigo] }) },
    "POST /api/v1/flights/offers/sandbox~a/price": {
      status: 410,
      body: { detail: "This offer has expired. Search again for a fresh price." },
    },
  });
  await user.click(within(list).getByRole("button", { name: "Verify price" }));
  expect(await within(list).findByRole("alert")).toHaveTextContent("This offer has expired. Search again for a fresh price.");
});

test("an empty board is explained", async () => {
  const { user } = scan({ [SEARCH]: { status: 200, body: searchResponse({ offers: [] }) } });
  await user.click(await screen.findByRole("button", { name: "Scan fares" }));
  expect(await screen.findByText("No offers for this route and date.")).toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Supplier sweep" })).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Flight offers" })).not.toBeInTheDocument();
});

test("fare results are cleared when the session resets", async () => {
  const { queryClient, unmount } = await scanAndList({ [SEARCH]: { status: 200, body: searchResponse() } });
  unmount();
  expect(queryClient.getQueriesData({ queryKey: ["flights"] })).not.toHaveLength(0);
  resetSessionState(queryClient);
  expect(queryClient.getQueriesData({ queryKey: ["flights"] })).toHaveLength(0);
});

test("a failed scan shows the reason", async () => {
  const { user } = scan({
    [SEARCH]: { status: 503, body: { detail: "No flight suppliers are connected yet. Add a supplier key or enable the sandbox." } },
  });
  await user.click(await screen.findByRole("button", { name: "Scan fares" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No flight suppliers are connected yet.");
});

test("supplier CO₂ is labelled as the supplier's estimate", async () => {
  const supplierCo2 = { ...indigo, co2_kg_per_passenger: 110, co2_source: "supplier" as const };
  const { list } = await scanAndList({ [SEARCH]: { status: 200, body: searchResponse({ offers: [supplierCo2] }) } });
  expect(within(list).getByRole("article")).toHaveTextContent("110 kg CO₂e · supplier est.");
});

test("an unconverted price is shown as billed, without ≈", async () => {
  const unconverted = { ...indigo, total: { amount_minor: 10000, currency: "USD" }, display_total: null };
  const { list } = await scanAndList({ [SEARCH]: { status: 200, body: searchResponse({ offers: [unconverted] }) } });
  const card = within(list).getByRole("article");
  expect(card).toHaveAccessibleName("IndiGo $100");
  expect(card).toHaveTextContent("$100");
  expect(card).not.toHaveTextContent("≈");
  expect(card).not.toHaveTextContent("Billed");
});

test("missing CO₂ and durations are not invented", async () => {
  const bare = makeOffer({
    id: "sandbox~bare",
    co2_kg_per_passenger: null,
    co2_source: null,
    slices: [{ ...makeOffer().slices[0]!, duration_minutes: null }],
  });
  const { list } = await scanAndList({ [SEARCH]: { status: 200, body: searchResponse({ offers: [bare] }) } });
  const card = within(list).getByRole("article");
  expect(card).not.toHaveTextContent("CO₂");
  expect(card).toHaveTextContent("—");
});

test("scanning the same trip again asks the suppliers again", async () => {
  const { list, user, calls } = await scanAndList({ [SEARCH]: { status: 200, body: searchResponse() } });
  expect(list).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Scan fares" }));
  await screen.findByRole("list", { name: "Flight offers" });
  expect(calls.filter((c) => c.path === "/api/v1/flights/search")).toHaveLength(2);
});

test("a failed re-scan hides the earlier price check", async () => {
  let attempt = 0;
  const { user } = await scanAndList({
    [SEARCH]: () =>
      ++attempt === 1
        ? {
            status: 200,
            body: searchResponse({
              baseline: { family: "market", currency: "INR", sample_size: 24, p25_minor: 450000, median_minor: 520000, p75_minor: 600000, window_days: 45 },
            }),
          }
        : { status: 429, body: { detail: "Too many searches. Try again in a minute." } },
  });
  expect(screen.getByRole("region", { name: "Price check" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Scan fares" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Too many searches.");
  expect(screen.queryByRole("region", { name: "Price check" })).not.toBeInTheDocument();
});

test("adults can be cleared and retyped, and are clamped when the field is left", async () => {
  const { user, calls } = scan({ [SEARCH]: { status: 200, body: searchResponse() } });
  const adults = await screen.findByRole("spinbutton", { name: "Adults" });
  await user.clear(adults);
  expect(adults).toHaveValue(null);
  await user.type(adults, "3");
  expect(adults).toHaveValue(3);
  await user.click(screen.getByRole("button", { name: "Scan fares" }));
  await screen.findByRole("list", { name: "Flight offers" });
  expect(calls.find((c) => c.path === "/api/v1/flights/search")?.body).toMatchObject({ adults: 3 });

  await user.clear(adults);
  await user.type(adults, "42");
  await user.tab();
  expect(adults).toHaveValue(9);
  await user.clear(adults);
  await user.tab();
  expect(adults).toHaveValue(1);
});

test("an empty adults field is sent as one traveller", async () => {
  const { user, calls } = scan({ [SEARCH]: { status: 200, body: searchResponse() } });
  const adults = await screen.findByRole("spinbutton", { name: "Adults" });
  await user.clear(adults);
  fireEvent.submit(adults.closest("form")!);
  await screen.findByRole("list", { name: "Flight offers" });
  expect(calls.find((c) => c.path === "/api/v1/flights/search")?.body).toMatchObject({ adults: 1 });
  expect(adults).toHaveValue(1);
});

test("a departure in the past can't be scanned", async () => {
  scan({});
  const depart = await screen.findByLabelText("Depart");
  fireEvent.change(depart, { target: { value: isoDateFromNow(-1) } });
  expect(depart).toHaveAccessibleDescription("Departure can't be in the past.");
  expect(screen.getByRole("button", { name: "Scan fares" })).toBeDisabled();
});
