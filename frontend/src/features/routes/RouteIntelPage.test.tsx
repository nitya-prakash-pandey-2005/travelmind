import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { mockApi } from "../../test/mockApi";
import { renderApp } from "../../test/renderApp";
import { routeStore } from "../route/routeStore";
import { DEL_BOM, EMPTY_ROUTE, routeIntelMocks } from "./routeIntelFixtures";

vi.mock("../globe/webgl", () => ({ hasWebGL: () => false }));

beforeEach(() => routeStore.reset());

function intelCalls(calls: ReturnType<typeof mockApi>["calls"]) {
  return calls.filter((c) => c.path === "/api/v1/routes/intel");
}

test("with no route chosen it offers the agency's own routes to start from", async () => {
  const { calls } = mockApi(routeIntelMocks());
  const { user, router } = renderApp("/app/routes");
  expect(await screen.findByRole("heading", { level: 1, name: "Route intel" })).toBeInTheDocument();
  expect(screen.getByText("Origin")).toBeInTheDocument();
  expect(screen.getByLabelText("Destination")).toBeInTheDocument();
  expect(screen.getByLabelText("Cabin")).toHaveValue("economy");

  const suggestions = await screen.findByRole("region", { name: "Your routes" });
  const delBom = await within(suggestions).findByRole("button", { name: /^DEL → BOM/ });
  expect(delBom).toHaveTextContent("2 enquiries");
  expect(delBom).toHaveTextContent("₹4,500");
  expect(within(suggestions).getByRole("button", { name: /^BOM → GOI/ })).toBeInTheDocument();
  expect(intelCalls(calls)).toHaveLength(0);

  await user.click(delBom);
  await waitFor(() =>
    expect(router.state.location.search).toEqual({ origin: "DEL", destination: "BOM", cabin: "economy" }),
  );
  expect(await screen.findByText("Market data")).toBeInTheDocument();
});

test("a route shows its figures, trend, days-out medians, carriers and the agency's searches", async () => {
  const { calls } = mockApi(routeIntelMocks());
  renderApp("/app/routes?origin=DEL&destination=BOM&cabin=economy");
  expect(await screen.findByText("Market data")).toBeInTheDocument();
  const call = intelCalls(calls)[0];
  expect(call?.search.get("origin")).toBe("DEL");
  expect(call?.search.get("destination")).toBe("BOM");
  expect(call?.search.get("cabin")).toBe("economy");

  expect(await screen.findByRole("button", { name: "Change Origin" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Change Destination" })).toBeInTheDocument();

  const figures = screen.getByRole("region", { name: "Route figures" });
  expect(within(figures).getByRole("group", { name: /^Median now: ₹4\.8K/ })).toBeInTheDocument();
  expect(within(figures).getByRole("group", { name: /^Typical range: ₹4\.3K to ₹5\.4K/ })).toBeInTheDocument();
  expect(within(figures).getByRole("group", { name: /^Fares seen: 42/ })).toBeInTheDocument();
  expect(within(figures).getByRole("group", { name: /^Best time to book: 22–45 days out/ })).toBeInTheDocument();
  expect(within(figures).getByRole("group", { name: /^Last updated: 1 h ago/ })).toBeInTheDocument();

  expect(screen.getByRole("img", { name: /^Daily median fare/ })).toBeInTheDocument();
  const trendTable = screen.getByRole("table", { name: "Daily median fare data" });
  expect(within(trendTable).getByRole("row", { name: /30 Sep ₹4,711 ₹4,200–₹5,450/ })).toBeInTheDocument();

  expect(screen.getByRole("img", { name: /^Median fare by days before departure: 0–7 days ₹6,100/ })).toBeInTheDocument();

  const carriers = screen.getByRole("table", { name: "Carriers on DEL → BOM" });
  const rows = within(carriers).getAllByRole("row");
  expect(rows).toHaveLength(4);
  expect(within(rows[1]!).getByText("6E")).toBeInTheDocument();
  expect(within(rows[1]!).getByText("₹4,700")).toBeInTheDocument();
  expect(within(rows[1]!).getByText("48%")).toBeInTheDocument();

  const searches = screen.getByRole("region", { name: "Your searches" });
  const items = within(searches).getAllByRole("listitem");
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent("₹4,550");
  expect(items[0]).toHaveTextContent("2 adults");
  expect(items[0]).toHaveTextContent("per traveller");

  const scan = screen.getByRole("link", { name: "Scan fares" });
  expect(scan.getAttribute("href")).toContain("/app/fares?");
  expect(scan.getAttribute("href")).toContain("origin=DEL");
  expect(scan.getAttribute("href")).toContain("destination=BOM");
});

test("a long search history shows the newest six until expanded", async () => {
  const searches = Array.from({ length: 9 }, (_, i) => ({ ...DEL_BOM.your_searches[0]!, cheapest_minor: 400_000 + i * 1_000 }));
  mockApi(routeIntelMocks({ ...DEL_BOM, your_searches: searches }));
  const { user } = renderApp("/app/routes?origin=DEL&destination=BOM");
  const panel = await screen.findByRole("region", { name: "Your searches" });
  expect(within(panel).getAllByRole("listitem")).toHaveLength(6);
  await user.click(within(panel).getByRole("button", { name: "Show all 9 searches" }));
  expect(within(panel).getAllByRole("listitem")).toHaveLength(9);
  expect(within(panel).getByRole("button", { name: "Show fewer" })).toHaveAttribute("aria-expanded", "true");
});

test("the trend keeps calendar spacing: days without fares are gaps, not squeezed out", async () => {
  const [first, , , , last] = DEL_BOM.daily;
  mockApi(routeIntelMocks({ ...DEL_BOM, daily: [first!, last!] }));
  renderApp("/app/routes?origin=DEL&destination=BOM");
  const table = await screen.findByRole("table", { name: "Daily median fare data" });
  const rows = within(table).getAllByRole("row");
  expect(rows).toHaveLength(6);
  expect(within(table).getByRole("row", { name: "1 Oct — —" })).toBeInTheDocument();
  expect(within(table).getByRole("row", { name: /3 Oct ₹4,750 ₹4,300–₹5,400/ })).toBeInTheDocument();
  expect(document.querySelectorAll("[data-band]")).toHaveLength(2);
});

test("sandbox fares are labelled as demonstration data", async () => {
  mockApi(routeIntelMocks({ ...DEL_BOM, family: "sandbox" }));
  renderApp("/app/routes?origin=DEL&destination=BOM");
  expect(await screen.findByText("Sandbox data — for demonstration")).toBeInTheDocument();
});

test("a route with no fares says how to start its history", async () => {
  mockApi(routeIntelMocks(EMPTY_ROUTE));
  renderApp("/app/routes?origin=DEL&destination=BOM&cabin=business");
  expect(
    await screen.findByText("No fares seen on this route yet — scan fares to start its history."),
  ).toBeInTheDocument();
  const history = screen.getByRole("region", { name: "Fare history" });
  const link = within(history).getByRole("link", { name: "Scan fares" });
  expect(link.getAttribute("href")).toContain("cabin=business");
  expect(within(history).getByRole("link", { name: "Fare search" })).toHaveAttribute("href", "/app/fares");
  expect(screen.queryByText("Market data")).not.toBeInTheDocument();
  // Other routes stay one click away.
  expect(await screen.findByRole("region", { name: "Your routes" })).toBeInTheDocument();
});

test("swapping the airports and changing the cabin update the address", async () => {
  const { calls } = mockApi(routeIntelMocks());
  const { user, router } = renderApp("/app/routes?origin=DEL&destination=BOM");
  await screen.findByText("Market data");
  await user.click(screen.getByRole("button", { name: "Swap origin and destination" }));
  await waitFor(() => expect(router.state.location.search).toMatchObject({ origin: "BOM", destination: "DEL" }));
  await user.selectOptions(screen.getByLabelText("Cabin"), "business");
  await waitFor(() => expect(router.state.location.search).toMatchObject({ cabin: "business" }));
  await waitFor(() =>
    expect(intelCalls(calls).some((c) => c.search.get("origin") === "BOM" && c.search.get("cabin") === "business")).toBe(true),
  );
});

test("malformed address values are ignored", async () => {
  const { calls } = mockApi(routeIntelMocks());
  renderApp("/app/routes?origin=DELHI&destination=BOM&cabin=luxury");
  expect(await screen.findByRole("heading", { level: 1, name: "Route intel" })).toBeInTheDocument();
  expect(screen.getByLabelText("Cabin")).toHaveValue("economy");
  expect(screen.getByLabelText("Origin")).toHaveValue("");
  expect(await screen.findByRole("button", { name: "Change Destination" })).toBeInTheDocument();
  expect(intelCalls(calls)).toHaveLength(0);
});

test("a failed load explains and retries", async () => {
  let attempts = 0;
  mockApi(
    routeIntelMocks(DEL_BOM, {
      "GET /api/v1/routes/intel": () => {
        attempts += 1;
        return attempts === 1
          ? { status: 422, body: { detail: "Unknown airport code DEL." } }
          : { status: 200, body: DEL_BOM };
      },
    }),
  );
  const { user } = renderApp("/app/routes?origin=DEL&destination=BOM");
  expect(await screen.findByRole("alert")).toHaveTextContent("Unknown airport code DEL.");
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Market data")).toBeInTheDocument();
});
