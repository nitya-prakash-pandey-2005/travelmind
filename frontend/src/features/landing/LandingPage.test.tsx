import { screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { mockApi } from "../../test/mockApi";
import { renderApp, withSession } from "../../test/renderApp";
import type { GlobeArc } from "../globe/RouteGlobe";

const webgl = vi.hoisted(() => ({ available: false }));
vi.mock("../globe/webgl", () => ({ hasWebGL: () => webgl.available }));
vi.mock("../globe/RouteGlobe", () => ({
  default: ({ arcs }: { arcs: GlobeArc[] }) => (
    <div data-testid="globe">{arcs.map((a) => `${a.from.iata_code}-${a.to.iata_code}`).join(",")}</div>
  ),
}));

const FACTS = {
  airports: 8801,
  suppliers: [
    { kind: "flights", connected: 1 },
    { kind: "hotels", connected: 0 },
  ],
  routes_with_history: 42,
};

test("landing shows the pitch and real platform facts", async () => {
  mockApi(withSession(null, { "GET /api/v1/platform/facts": { status: 200, body: { airports: 8801, suppliers: [{ kind: "flights", connected: 1 }, { kind: "hotels", connected: 0 }], routes_with_history: 42 } } }));
  renderApp("/");
  expect(await screen.findByRole("heading", { level: 1, name: "The mission control for modern travel agencies" })).toBeInTheDocument();
  expect(await screen.findByText("8,801")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Explore live demo" })).toHaveAttribute("href", "/demo");
  expect(screen.getByRole("link", { name: "Start free" })).toHaveAttribute("href", "/signup");
});

test("platform facts read as labelled figures, one per fact", async () => {
  mockApi(withSession(null, { "GET /api/v1/platform/facts": { status: 200, body: FACTS } }));
  renderApp("/");
  const facts = await screen.findByRole("region", { name: "Platform facts" });
  await waitFor(() => expect(facts).not.toHaveAttribute("aria-busy"));
  expect(within(facts).getByText("8,801").closest("li")).toHaveTextContent("8,801airports indexed");
  expect(within(facts).getByText("1").closest("li")).toHaveTextContent("1supplier connected");
  expect(within(facts).getByText("42").closest("li")).toHaveTextContent("42routes with fare history");
});

test("platform facts show skeletons while loading", async () => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  mockApi(
    withSession(null, {
      "GET /api/v1/platform/facts": async () => {
        await ready;
        return { status: 200, body: FACTS };
      },
    }),
  );
  renderApp("/");
  const facts = await screen.findByRole("region", { name: "Platform facts" });
  expect(facts).toHaveAttribute("aria-busy", "true");
  expect(facts.querySelectorAll("[data-skeleton]").length).toBeGreaterThan(0);
  release();
  expect(await within(facts).findByText("8,801")).toBeInTheDocument();
});

test("platform facts are hidden when they can't be loaded", async () => {
  const { calls } = mockApi(
    withSession(null, { "GET /api/v1/platform/facts": { status: 500, body: { detail: "Boom" } } }),
  );
  renderApp("/");
  expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
  await waitFor(() => expect(calls.some((c) => c.path === "/api/v1/platform/facts")).toBe(true));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Platform facts" })).not.toBeInTheDocument());
  expect(screen.queryByText(/Boom|went wrong/)).not.toBeInTheDocument();
});

test("top navigation, features, steps and footer", async () => {
  mockApi(withSession(null, { "GET /api/v1/platform/facts": { status: 200, body: FACTS } }));
  renderApp("/");
  const nav = await screen.findByRole("navigation", { name: "Main" });
  expect(within(nav).getByText("TRAVELMIND")).toBeInTheDocument();
  expect(within(nav).getByRole("link", { name: "Features" })).toHaveAttribute("href", "#features");
  expect(within(nav).getByRole("link", { name: "How it works" })).toHaveAttribute("href", "#how-it-works");
  expect(within(nav).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  expect(within(nav).getByRole("link", { name: /^Start free/ })).toHaveAttribute("href", "/signup");

  const features = screen.getByRole("region", { name: /Features/ });
  const cards = within(features).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
  expect(cards).toEqual([
    "Every source at once",
    "Honest prices",
    "Fare intelligence",
    "CO₂ per passenger",
    "Quotes in minutes",
    "Built for teams",
  ]);
  const quotes = within(features).getByRole("heading", { name: "Quotes in minutes" }).closest("article");
  expect(quotes).toHaveTextContent("Coming in the next release");
  const search = within(features).getByRole("heading", { name: "Every source at once" }).closest("article");
  expect(search).not.toHaveTextContent("Coming in the next release");

  const steps = screen.getByRole("region", { name: "How it works" });
  expect(within(steps).getAllByRole("listitem").map((li) => li.querySelector("h3")?.textContent)).toEqual([
    "Capture the enquiry",
    "Scan every supplier",
    "Send the quote",
  ]);

  const footer = screen.getByRole("contentinfo");
  expect(footer).toHaveTextContent("© 2026 TravelMind");
  expect(within(footer).getByRole("link", { name: /^Sign in/ })).toHaveAttribute("href", "/login");
  expect(within(footer).getByRole("link", { name: /^Start free/ })).toHaveAttribute("href", "/signup");
});

test("the page has a descriptive title", async () => {
  mockApi(withSession(null, { "GET /api/v1/platform/facts": { status: 200, body: FACTS } }));
  renderApp("/");
  await screen.findByRole("heading", { level: 1 });
  await waitFor(() => expect(document.title).toBe("TravelMind — Mission control for travel agencies"));
});

test("without WebGL the popular routes are still listed", async () => {
  webgl.available = false;
  mockApi(withSession(null, { "GET /api/v1/platform/facts": { status: 200, body: FACTS } }));
  renderApp("/");
  const routes = await screen.findByRole("list", { name: "Popular routes" });
  expect(within(routes).getAllByRole("listitem").length).toBeGreaterThan(3);
  expect(routes).toHaveTextContent("DEL → DXB");
  expect(screen.queryByTestId("globe")).not.toBeInTheDocument();
});

test("with WebGL the globe draws the popular routes as arcs", async () => {
  webgl.available = true;
  mockApi(withSession(null, { "GET /api/v1/platform/facts": { status: 200, body: FACTS } }));
  renderApp("/");
  expect(await screen.findByTestId("globe")).toHaveTextContent("DEL-DXB");
  expect(screen.getByText("Popular routes")).toBeInTheDocument();
  webgl.available = false;
});
