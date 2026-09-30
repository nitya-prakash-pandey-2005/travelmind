import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { GlobeArc } from "../globe/RouteGlobe";
import { AIRPORTS, ME_AGENT, ME_OWNER } from "../../test/fixtures";
import { mockApi, type MockCall } from "../../test/mockApi";
import { renderApp, withSession } from "../../test/renderApp";
import { routeStore } from "../route/routeStore";

vi.mock("../globe/webgl", () => ({ hasWebGL: () => true }));
vi.mock("../globe/RouteGlobe", () => ({
  default: ({ arcs }: { arcs: GlobeArc[] }) => (
    <div data-testid="globe">
      {arcs.map((a) => `${a.from.iata_code}-${a.to.iata_code}${a.active ? "*" : ""}`).join(",")}
    </div>
  ),
}));

const search = (call: MockCall) => {
  const q = (call.search.get("q") ?? "").toLowerCase();
  const body = Object.values(AIRPORTS).filter((a) => a.iata_code.toLowerCase() === q);
  return { status: 200, body };
};

const TEAM = [
  { id: "u-owner", email: "asha@alphatravels.in", full_name: "Asha Rao", role: "owner" },
  { id: "u-agent", email: "ravi@alphatravels.in", full_name: "Ravi Kumar", role: "agent" },
];

beforeEach(() => routeStore.reset());

test("plotting a route draws it on the globe and remembers it", async () => {
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/reference/airports": search,
      "GET /api/v1/team": { status: 200, body: TEAM },
      "GET /api/v1/invitations": { status: 200, body: [] },
    }),
  );
  const { user } = renderApp("/app");
  expect(await screen.findByRole("heading", { name: "Welcome aboard, Asha" })).toBeInTheDocument();

  await user.type(screen.getByRole("combobox", { name: "From" }), "del");
  await user.click(await screen.findByRole("option", { name: /DEL/ }));
  await user.type(screen.getByRole("combobox", { name: "To" }), "bom");
  await user.click(await screen.findByRole("option", { name: /BOM/ }));

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
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/team": { status: 200, body: TEAM },
      "GET /api/v1/invitations": { status: 200, body: [] },
    }),
  );
  const { user } = renderApp("/app");
  expect(await screen.findByTestId("globe")).toHaveTextContent("LHR-JFK");
  await user.click(screen.getByRole("button", { name: /LHR → JFK/ }));
  expect(routeStore.get().origin?.iata_code).toBe("LHR");
  await waitFor(() => expect(screen.getByTestId("globe")).toHaveTextContent("LHR-JFK*"));
});

test("the agency panel shows crew and pending invitations to managers", async () => {
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/team": { status: 200, body: TEAM },
      "GET /api/v1/invitations": {
        status: 200,
        body: [
          {
            id: "i1",
            email: "neha@alphatravels.in",
            role: "agent",
            created_at: "2026-09-29T10:00:00Z",
            expires_at: "2026-10-06T10:00:00Z",
          },
        ],
      },
    }),
  );
  renderApp("/app");
  const panel = await screen.findByRole("region", { name: "Alpha Travels" });
  expect(await within(panel).findByText("2")).toBeInTheDocument();
  expect(await within(panel).findByText("1")).toBeInTheDocument();
});

test("agents never request the invitation list", async () => {
  const { calls } = mockApi(withSession(ME_AGENT, { "GET /api/v1/team": { status: 200, body: TEAM } }));
  renderApp("/app");
  await screen.findByRole("region", { name: "Alpha Travels" });
  expect(calls.some((c) => c.path === "/api/v1/invitations")).toBe(false);
});

test("a plotted route can be sent to the fare scanner", async () => {
  routeStore.set({ origin: AIRPORTS.DEL, destination: AIRPORTS.BOM });
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/team": { status: 200, body: TEAM },
      "GET /api/v1/invitations": { status: 200, body: [] },
    }),
  );
  const { user, router } = renderApp("/app");
  await user.click(await screen.findByRole("button", { name: "Scan fares for this route" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/app/fares"));
  expect(await screen.findByRole("heading", { name: "Scan live fares" })).toBeInTheDocument();
});
