import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { AIRPORTS, ME_OWNER } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { renderApp, withSession } from "../../test/renderApp";
import { commandCenterMocks } from "../../test/workspaceFixtures";
import type { GlobeArc } from "../globe/RouteGlobe";
import { routeStore } from "../route/routeStore";

vi.mock("../globe/webgl", () => ({ hasWebGL: () => true }));
vi.mock("../globe/RouteGlobe", () => ({
  default: ({ arcs }: { arcs: GlobeArc[] }) => (
    <div data-testid="globe">
      {arcs.map((a) => `${a.from.iata_code}-${a.to.iata_code}${a.active ? "*" : ""}`).join(",")}
    </div>
  ),
}));

beforeEach(() => routeStore.reset());

/** A panel as it is now: a panel's loading, error and loaded states are separate elements. */
const region = (name: string) => screen.getByRole("region", { name });
/** Waits until the named panel has finished loading, then returns it. */
async function loaded(name: string): Promise<HTMLElement> {
  await waitFor(() => expect(region(name)).not.toHaveAttribute("aria-busy"));
  return region(name);
}

test("command center renders every panel from real API data", async () => {
  mockApi(withSession(ME_OWNER, commandCenterMocks({ populated: true })));
  renderApp("/app");
  expect(await screen.findByRole("heading", { level: 1, name: /Asha/ })).toBeInTheDocument();
  expect(await screen.findByRole("group", { name: /Open enquiries/ })).toHaveTextContent("12");
  expect(screen.getByRole("group", { name: /Win rate/ })).toHaveTextContent("58.3%");
  expect(screen.getByRole("region", { name: "Pipeline" })).toHaveTextContent("Quoted");
  expect(screen.getByRole("region", { name: "Market pulse" })).toHaveTextContent("DEL → BOM");
  expect(screen.getByRole("region", { name: "Supplier health" })).toHaveTextContent("sandbox");
  expect(screen.getByRole("region", { name: "Live activity" })).toHaveTextContent("Searched DEL → BOM");
  expect(screen.getByRole("table", { name: "Upcoming departures" })).toBeInTheDocument();
});

test("command center empty workspace", async () => {
  mockApi(withSession(ME_OWNER, commandCenterMocks({ populated: false })));
  renderApp("/app");
  expect(await screen.findByRole("group", { name: /Win rate/ })).toHaveTextContent("—");
  // No option quoted with CO₂ yet: unknown, not zero.
  const co2 = screen.getByRole("group", { name: /CO₂ quoted/ });
  expect(co2).toHaveTextContent("—");
  expect(co2).not.toHaveTextContent(/0/);
  expect(within(co2).getByText("No CO₂ figures quoted yet")).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Market pulse" })).toHaveTextContent("trends appear after two weeks");
  expect(screen.getByText("0 of 6 done")).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/NaN|undefined/);
});

test("the header greets by agency time and offers the range switch and New enquiry", async () => {
  mockApi(withSession(ME_OWNER, commandCenterMocks({ populated: true })));
  renderApp("/app");
  const heading = await screen.findByRole("heading", { level: 1 });
  expect(heading).toHaveTextContent(/^Good (morning|afternoon|evening), Asha$/);
  expect(within(screen.getByRole("main")).getByText("Command Center")).toBeInTheDocument();
  const range = screen.getByRole("radiogroup", { name: "Range" });
  expect(within(range).getByRole("radio", { name: "30d" })).toBeChecked();
  expect(screen.getByRole("button", { name: "New enquiry" })).toBeInTheDocument();
});

test("KPIs are formatted by unit, with deltas and gaps", async () => {
  mockApi(withSession(ME_OWNER, commandCenterMocks({ populated: true })));
  renderApp("/app");
  expect(await screen.findByRole("group", { name: /Pipeline value/ })).toHaveTextContent("₹6.2L");
  expect(screen.getByRole("group", { name: /Response time/ })).toHaveTextContent("43m");
  expect(screen.getByRole("group", { name: /CO₂ quoted/ })).toHaveTextContent("1,240");
  expect(screen.getByRole("group", { name: /Searches/ })).toHaveTextContent("146");
  // Open enquiries 12 vs 10: up 20 %, a good move. Response time 42.5 vs 55 min: down 23 %, also good.
  expect(screen.getByRole("group", { name: /Open enquiries/ })).toHaveAccessibleName(/up 20%/);
  expect(screen.getByRole("group", { name: /Response time/ })).toHaveAccessibleName(/down 23%/);
  expect(document.body.textContent).not.toMatch(/NaN|undefined/);
});

test("range switch refetches with the new range", async () => {
  const { calls } = mockApi(withSession(ME_OWNER, commandCenterMocks({ populated: true })));
  const { user, router } = renderApp("/app");
  await screen.findByRole("group", { name: /Open enquiries/ });
  expect(calls.filter((c) => c.path === "/api/v1/dashboard/summary").map((c) => c.search.get("range"))).toEqual(["30d"]);

  await user.click(screen.getByRole("radio", { name: "90d" }));

  await waitFor(() =>
    expect(calls.some((c) => c.path === "/api/v1/dashboard/summary" && c.search.get("range") === "90d")).toBe(true),
  );
  expect(calls.some((c) => c.path === "/api/v1/dashboard/team" && c.search.get("range") === "90d")).toBe(true);
  await waitFor(() => expect(router.state.location.search).toEqual({ range: "90d" }));
  expect(router.state.location.href).toContain("range=90d");
  expect(screen.getByRole("radio", { name: "90d" })).toBeChecked();
});

test("the range comes from the URL", async () => {
  const { calls } = mockApi(withSession(ME_OWNER, commandCenterMocks({ populated: true })));
  renderApp("/app?range=7d");
  await screen.findByRole("group", { name: /Open enquiries/ });
  expect(within(screen.getByRole("radiogroup", { name: "Range" })).getByRole("radio", { name: "7d" })).toBeChecked();
  expect(calls.filter((c) => c.path === "/api/v1/dashboard/summary").map((c) => c.search.get("range"))).toEqual(["7d"]);
});

test("a failing panel shows retry without breaking others", async () => {
  let pulseCalls = 0;
  const mocks = commandCenterMocks({ populated: true });
  mockApi(
    withSession(ME_OWNER, {
      ...mocks,
      "GET /api/v1/dashboard/market-pulse": (call) => {
        pulseCalls += 1;
        if (pulseCalls === 1) return { status: 500, body: { detail: "Something went wrong on our side. Please try again." } };
        const handler = mocks["GET /api/v1/dashboard/market-pulse"];
        return typeof handler === "function" ? handler(call) : handler!;
      },
    }),
  );
  const { user } = renderApp("/app");
  expect(await screen.findByRole("group", { name: /Open enquiries/ })).toHaveTextContent("12");
  await waitFor(() => expect(within(region("Market pulse")).getByRole("alert")).toHaveTextContent(/went wrong/));
  expect(region("Pipeline")).toHaveTextContent("Quoted");

  await user.click(within(region("Market pulse")).getByRole("button", { name: "Retry" }));
  const pulseNow = () => region("Market pulse");
  await waitFor(() => expect(pulseNow()).toHaveTextContent("DEL → BOM"));
  expect(within(pulseNow()).queryByRole("alert")).not.toBeInTheDocument();
});

test("new enquiry dialog creates an enquiry and toasts", async () => {
  const { calls } = mockApi(withSession(ME_OWNER, commandCenterMocks({ populated: true })));
  const { user } = renderApp("/app");
  await screen.findByRole("group", { name: /Open enquiries/ });
  const summaryCalls = () => calls.filter((c) => c.path === "/api/v1/dashboard/summary").length;
  const before = summaryCalls();

  await user.click(screen.getByRole("button", { name: "New enquiry" }));
  const dialog = await screen.findByRole("dialog", { name: "New enquiry" });
  await user.type(within(dialog).getByRole("combobox", { name: "From" }), "del");
  await user.click(await within(dialog).findByRole("option", { name: /DEL/ }));
  await user.type(within(dialog).getByRole("combobox", { name: "To" }), "bom");
  await user.click(await within(dialog).findByRole("option", { name: /BOM/ }));
  await user.click(within(dialog).getByRole("radio", { name: "New client" }));
  await user.type(within(dialog).getByLabelText("Client name"), "Priya");
  await user.click(within(dialog).getByRole("button", { name: "Create enquiry" }));

  expect(await screen.findByText("Enquiry E-0007 created")).toBeInTheDocument();
  const posts = calls.filter((c) => c.method === "POST");
  expect(posts.map((c) => c.path)).toEqual(["/api/v1/clients", "/api/v1/enquiries"]);
  expect(posts[0]?.body).toEqual({ name: "Priya" });
  expect(posts[1]?.body).toMatchObject({ client_id: "c-new", origin: "DEL", destination: "BOM", adults: 1, cabin: "economy" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "New enquiry" })).not.toBeInTheDocument());
  await waitFor(() => expect(summaryCalls()).toBeGreaterThan(before));
});

test("live activity pages back with the last item's time and id", async () => {
  const { calls } = mockApi(withSession(ME_OWNER, commandCenterMocks({ populated: true })));
  const { user } = renderApp("/app");
  await screen.findByRole("region", { name: "Live activity" });
  const feed = await loaded("Live activity");
  expect(within(feed).getByText("5 min ago")).toBeInTheDocument();
  expect(within(feed).getAllByRole("listitem")).toHaveLength(20);

  await user.click(within(feed).getByRole("button", { name: "Load more" }));
  expect(await within(feed).findByText("Removed client Old Contact")).toBeInTheDocument();
  const page = calls.find((c) => c.path === "/api/v1/dashboard/activity" && c.search.get("before"));
  expect(page?.search.get("before_id")).toBe("act-20");
  expect(page?.search.get("limit")).toBe("20");
  // A short page means there is nothing older.
  expect(within(feed).queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
});

test("the route globe draws enquiry routes and highlights won ones", async () => {
  mockApi(withSession(ME_OWNER, commandCenterMocks({ populated: true })));
  renderApp("/app");
  const globe = await screen.findByTestId("globe");
  await waitFor(() => expect(globe).toHaveTextContent("DEL-BOM*"));
  expect(globe).toHaveTextContent("BOM-GOI");
  expect(globe).toHaveTextContent("LHR-JFK");
  expect(globe.textContent).not.toContain("BOM-GOI*");
});

test("supplier health switches between 24 hours and 7 days", async () => {
  const { calls } = mockApi(withSession(ME_OWNER, commandCenterMocks({ populated: true })));
  const { user } = renderApp("/app");
  await screen.findByRole("region", { name: "Supplier health" });
  const panel = await loaded("Supplier health");
  expect(within(panel).getByText("95.2%")).toBeInTheDocument();
  expect(within(panel).getByRole("img", { name: /sandbox flights latency/ })).toBeInTheDocument();
  expect(within(panel).getByText("No successful calls")).toBeInTheDocument();

  await user.click(within(panel).getByRole("radio", { name: "7d" }));
  await waitFor(() => expect(within(region("Supplier health")).getByText("98.3%")).toBeInTheDocument());
  expect(calls.some((c) => c.path === "/api/v1/dashboard/supplier-health" && c.search.get("range") === "7d")).toBe(true);
});

test("an empty workspace explains every panel and offers the next step", async () => {
  mockApi(withSession(ME_OWNER, commandCenterMocks()));
  renderApp("/app");
  await screen.findByRole("region", { name: "Supplier health" });
  const supplier = await loaded("Supplier health");
  expect(within(supplier).getByText("No supplier calls yet.")).toBeInTheDocument();
  expect(within(supplier).getByRole("link", { name: "Open suppliers" })).toHaveAttribute("href", "/app/suppliers");
  const departures = await loaded("Upcoming departures");
  expect(within(departures).getByText("Won trips with upcoming departures show here.")).toBeInTheDocument();
  for (const name of ["Live activity", "Pipeline", "Activity trend", "Team", "Market pulse"]) {
    expect(within(await loaded(name)).getByRole("status")).toBeInTheDocument();
  }
});

test("the onboarding checklist tracks progress and can be dismissed per agency", async () => {
  mockApi(withSession(ME_OWNER, commandCenterMocks({ populated: true })));
  const { user, unmount } = renderApp("/app");
  await screen.findByRole("region", { name: "Get set up" });
  const checklist = await loaded("Get set up");
  expect(within(checklist).getByText("3 of 6 done")).toBeInTheDocument();
  expect(within(checklist).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "3");
  expect(within(checklist).getByRole("link", { name: /Run your first fare scan/ })).toHaveAttribute("href", "/app/fares");
  expect(within(checklist).getByRole("button", { name: /Add a client/ })).toBeInTheDocument();
  // Steps whose screens aren't built yet are listed, but lead nowhere.
  for (const label of ["Add your agency details", "Send your first quote"]) {
    expect(within(checklist).queryByRole("link", { name: new RegExp(label) })).not.toBeInTheDocument();
    expect(within(checklist).queryByRole("button", { name: new RegExp(label) })).not.toBeInTheDocument();
    const item = within(checklist).getByText(label).closest("li")!;
    expect(within(item).getByText("Coming in the next release")).toBeInTheDocument();
  }
  expect(within(checklist).getAllByText("Coming in the next release")).toHaveLength(2);

  await user.click(within(checklist).getByRole("button", { name: "Dismiss checklist" }));
  expect(screen.queryByRole("region", { name: "Get set up" })).not.toBeInTheDocument();
  expect(window.localStorage.getItem("tm-onboarding-dismissed:a-alpha")).toBe("1");
  unmount();

  renderApp("/app");
  await screen.findByRole("group", { name: /Open enquiries/ });
  expect(screen.queryByRole("region", { name: "Get set up" })).not.toBeInTheDocument();
});

test("a finished checklist is hidden", async () => {
  const mocks = commandCenterMocks({ populated: true });
  mockApi(
    withSession(ME_OWNER, {
      ...mocks,
      "GET /api/v1/onboarding": {
        status: 200,
        body: {
          items: [
            { key: "profile", label: "Add your agency details", done: true, available: false, href: null },
            { key: "supplier", label: "Connect a live supplier", done: true, available: true, href: "/app/suppliers" },
            { key: "team", label: "Invite a teammate", done: true, available: true, href: "/app/team" },
            { key: "fare_scan", label: "Run your first fare scan", done: true, available: true, href: "/app/fares" },
            { key: "client", label: "Add a client", done: true, available: true, href: "/app" },
            { key: "quote", label: "Send your first quote", done: true, available: false, href: null },
          ],
          completed: 6,
          total: 6,
        },
      },
    }),
  );
  renderApp("/app");
  await screen.findByRole("group", { name: /Open enquiries/ });
  await waitFor(() => expect(screen.queryByText(/of 6 done/)).not.toBeInTheDocument());
});

test("plotting a route in Quick route draws it on the globe and remembers it", async () => {
  mockApi(withSession(ME_OWNER, commandCenterMocks()));
  const { user } = renderApp("/app");
  const scanner = await screen.findByRole("region", { name: "Plot a route" });
  await user.type(within(scanner).getByRole("combobox", { name: "From" }), "del");
  await user.click(await within(scanner).findByRole("option", { name: /DEL/ }));
  await user.type(within(scanner).getByRole("combobox", { name: "To" }), "bom");
  await user.click(await within(scanner).findByRole("option", { name: /BOM/ }));

  expect(await screen.findByTestId("globe")).toHaveTextContent("DEL-BOM*");
  const recent = screen.getByRole("region", { name: "Recent routes" });
  expect(within(recent).getByRole("button", { name: /DEL → BOM/ })).toHaveTextContent("1,138 km");
  expect(window.localStorage.getItem("tm-recent-routes:u-owner")).toContain('"BOM"');
});

test("clicking a recent route re-plots it", async () => {
  window.localStorage.setItem(
    "tm-recent-routes:u-owner",
    JSON.stringify([{ origin: AIRPORTS.LHR, destination: AIRPORTS.JFK, scannedAt: "2026-09-29T10:00:00.000Z" }]),
  );
  mockApi(withSession(ME_OWNER, commandCenterMocks()));
  const { user } = renderApp("/app");
  const recent = await screen.findByRole("region", { name: "Recent routes" });
  await user.click(within(recent).getByRole("button", { name: /LHR → JFK/ }));
  expect(routeStore.get().origin?.iata_code).toBe("LHR");
  await waitFor(() => expect(screen.getByTestId("globe")).toHaveTextContent("LHR-JFK*"));
});

test("a plotted route can be sent to the fare scanner", async () => {
  routeStore.set({ origin: AIRPORTS.DEL, destination: AIRPORTS.BOM });
  mockApi(withSession(ME_OWNER, commandCenterMocks()));
  const { user, router } = renderApp("/app");
  await user.click(await screen.findByRole("button", { name: "Scan fares for this route" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/app/fares"));
  expect(await screen.findByRole("heading", { name: "Scan live fares" })).toBeInTheDocument();
});
