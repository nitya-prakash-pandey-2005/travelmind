import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { mockApi } from "../../test/mockApi";
import { renderApp, withSession } from "../../test/renderApp";
import type { GlobeArc } from "../globe/RouteGlobe";
import { FACTS_DEADLINE_MS } from "./PlatformFacts";

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
  mockApi(withSession(null, { "GET /api/v1/platform/facts": { status: 200, body: FACTS } }));
  renderApp("/");
  expect(await screen.findByRole("heading", { level: 1, name: "Answer travel enquiries with fares you can explain" })).toBeInTheDocument();
  expect(await screen.findByText("8,801")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open demo workspace" })).toHaveAttribute("href", "/demo");
  expect(screen.getByRole("link", { name: "Create workspace" })).toHaveAttribute("href", "/signup");
});

const factItems = () => within(screen.getByRole("list", { name: "Platform facts" })).getAllByRole("listitem");

test("platform facts show what is true by construction, then the platform's own counts", async () => {
  mockApi(withSession(null, { "GET /api/v1/platform/facts": { status: 200, body: FACTS } }));
  renderApp("/");
  const section = await screen.findByRole("region", { name: "Built on real travel data" });
  const texts = factItems().map((li) => li.textContent);
  expect(texts).toContainEqual(expect.stringMatching(/^6data sources/));
  expect(texts).toContainEqual(expect.stringMatching(/^3price labels/));
  expect(texts).toContainEqual(expect.stringMatching(/^2workspace currenciesINR and USD/));
  // The airport tile swaps its static "8,800+" for the service's count, and the live line appears.
  expect((await within(section).findByText("8,801")).closest("li")).toHaveTextContent("8,801airports indexed");
  expect(section).toHaveTextContent("Live from the platform");
  expect(section).toHaveTextContent("1 supplier connected");
  expect(section).toHaveTextContent("42 routes with fare history");
});

test("platform facts never wait on skeletons: static figures show while the platform is slow", async () => {
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
  const section = await screen.findByRole("region", { name: "Built on real travel data" });
  expect(section.querySelectorAll("[data-skeleton]")).toHaveLength(0);
  expect(factItems()).toHaveLength(6);
  expect(within(section).getByText("8,800+")).toBeInTheDocument();
  expect(section).toHaveTextContent("Checking live figures from the platform…");
  release();
  expect(await within(section).findByText("8,801")).toBeInTheDocument();
  expect(within(section).queryByText("8,800+")).not.toBeInTheDocument();
});

test("platform facts keep their static figures, without the live line, when the platform fails", async () => {
  const { calls } = mockApi(withSession(null, { "GET /api/v1/platform/facts": { status: 500, body: { detail: "Boom" } } }));
  renderApp("/");
  const section = await screen.findByRole("region", { name: "Built on real travel data" });
  await waitFor(() => expect(calls.some((c) => c.path === "/api/v1/platform/facts")).toBe(true));
  await waitFor(() => expect(section).not.toHaveTextContent("Checking live figures"));
  expect(factItems()).toHaveLength(6);
  expect(within(section).getByText("8,800+")).toBeInTheDocument();
  expect(section).not.toHaveTextContent("Live from the platform");
  expect(screen.queryByText(/Boom|went wrong/)).not.toBeInTheDocument();
});

test("after the deadline the facts band is complete and static, never an empty or skeleton state", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    mockApi(withSession(null, { "GET /api/v1/platform/facts": () => new Promise(() => {}) }));
    renderApp("/");
    const section = await screen.findByRole("region", { name: "Built on real travel data" });
    expect(section).toHaveTextContent("Checking live figures from the platform…");
    await act(() => vi.advanceTimersByTimeAsync(FACTS_DEADLINE_MS));
    await waitFor(() => expect(section).not.toHaveTextContent("Checking live figures"));
    expect(section.querySelectorAll("[data-skeleton]")).toHaveLength(0);
    expect(factItems()).toHaveLength(6);
    for (const item of factItems()) expect(item.textContent?.trim()).not.toBe("");
    expect(within(section).getByText("8,800+")).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test("the hero's product picture is labelled as sample data", async () => {
  mockApi(withSession(null, { "GET /api/v1/platform/facts": { status: 200, body: FACTS } }));
  renderApp("/");
  const hero = (await screen.findByRole("heading", { level: 1 })).closest("section") as HTMLElement;
  expect(within(hero).getByText("Illustration with sample data: names, fares, latencies and figures are examples, not live results.")).toBeInTheDocument();
  expect(hero.querySelector("figure [aria-hidden='true']")?.textContent).toContain("Sample data");
});

test("the integrations strip names the real data sources, as text", async () => {
  mockApi(withSession(null, { "GET /api/v1/platform/facts": { status: 200, body: FACTS } }));
  renderApp("/");
  const strip = await screen.findByRole("region", { name: "Connects to" });
  const names = within(strip)
    .getAllByRole("listitem")
    .map((li) => li.textContent);
  expect(names).toEqual([
    expect.stringMatching(/^Duffel/),
    expect.stringMatching(/^LiteAPI/),
    expect.stringMatching(/^Travel Impact Model.*Google/),
    expect.stringMatching(/^Travelpayouts/),
    expect.stringMatching(/^ECB reference rates/),
    expect.stringMatching(/^OurAirports8,800\+ airports/),
  ]);
  expect(strip.querySelector("img")).toBeNull();
});

test("the product tour switches screens by click and by arrow keys, and shows quotes as shipped", async () => {
  const user = userEvent.setup();
  mockApi(withSession(null, { "GET /api/v1/platform/facts": { status: 200, body: FACTS } }));
  renderApp("/");
  const tour = await screen.findByRole("region", { name: "One workspace, from enquiry to quote" });
  const tablist = within(tour).getByRole("tablist", { name: "Product tour" });
  const tabs = within(tablist).getAllByRole("tab");
  expect(tabs).toHaveLength(4);
  for (const [index, name] of ["Command Center", "Fare search", "Pipeline and quotes", "Team and roles"].entries()) {
    expect(tabs[index]).toHaveAccessibleName(name);
  }
  expect(within(tour).getByRole("tab", { name: "Command Center" })).toHaveAttribute("aria-selected", "true");
  expect(within(tour).getByRole("tabpanel", { name: "Command Center" })).toHaveTextContent("Illustration of the Command Center with sample data.");

  await user.click(within(tour).getByRole("tab", { name: "Pipeline and quotes" }));
  const pipeline = within(tour).getByRole("tabpanel", { name: "Pipeline and quotes" });
  expect(pipeline).not.toHaveTextContent(/next release/i);
  expect(pipeline).toHaveTextContent("Quotes with up to three options, your markup and a link the client can accept");

  await user.keyboard("{ArrowDown}");
  expect(within(tour).getByRole("tab", { name: "Team and roles" })).toHaveFocus();
  expect(within(tour).getByRole("tabpanel", { name: "Team and roles" })).toHaveTextContent("Owner, admin and agent roles");
  await user.keyboard("{ArrowDown}");
  expect(within(tour).getByRole("tab", { name: "Command Center" })).toHaveAttribute("aria-selected", "true");
  await user.keyboard("{End}");
  expect(within(tour).getByRole("tab", { name: "Team and roles" })).toHaveAttribute("aria-selected", "true");

  await user.click(within(tour).getByRole("tab", { name: "Fare search" }));
  expect(within(tour).getByRole("tabpanel", { name: "Fare search" })).toHaveTextContent(/not live results/);
});

test("the hero promises only what ships today", async () => {
  mockApi(withSession(null, { "GET /api/v1/platform/facts": { status: 200, body: FACTS } }));
  renderApp("/");
  expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
  expect(
    screen.getByText(
      "TravelMind searches your airline and hotel suppliers in one pass, shows whether each fare is good for its route, and turns each enquiry into a quote your client can open and accept. Every price says whether it is live, cached or sandbox.",
    ),
  ).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/send polished quotes/);
  // Quotes have shipped: nothing on the page is still announced as upcoming.
  expect(document.body.textContent).not.toMatch(/next release|coming soon/i);
  // No invented social proof anywhere on the page.
  expect(document.body.textContent).not.toMatch(/trusted by|testimonial|customers love|★/i);
});

test("top navigation, features, steps, security, FAQ and footer", async () => {
  mockApi(withSession(null, { "GET /api/v1/platform/facts": { status: 200, body: FACTS } }));
  renderApp("/");
  const nav = await screen.findByRole("navigation", { name: "Main" });
  expect(within(nav).getByRole("link", { name: "TravelMind" })).toHaveAttribute("href", "/");
  expect(within(nav).getByRole("link", { name: "Product" })).toHaveAttribute("href", "#product");
  expect(within(nav).getByRole("link", { name: "Features" })).toHaveAttribute("href", "#features");
  expect(within(nav).getByRole("link", { name: "How it works" })).toHaveAttribute("href", "#how-it-works");
  expect(within(nav).getByRole("link", { name: "Security" })).toHaveAttribute("href", "#security");
  expect(within(nav).getByRole("link", { name: "FAQ" })).toHaveAttribute("href", "#faq");
  expect(within(nav).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  expect(within(nav).getByRole("link", { name: /^Create workspace/ })).toHaveAttribute("href", "/signup");

  const features = screen.getByRole("region", { name: /Features/ });
  const cards = within(features)
    .getAllByRole("heading", { level: 3 })
    .map((h) => h.textContent);
  expect(cards).toEqual([
    "Every supplier in one search",
    "Prices labelled by source",
    "Fare insight",
    "CO₂ per passenger",
    "Hotel search",
    "One pipeline for enquiries",
    "Search from anywhere",
    "Quotes clients can open anywhere",
  ]);
  const quotes = within(features).getByRole("heading", { name: "Quotes clients can open anywhere" }).closest("article");
  expect(quotes).not.toHaveTextContent(/next release/i);
  expect(quotes).toHaveTextContent("accept");

  const steps = screen.getByRole("region", { name: "How it works" });
  expect(
    within(steps)
      .getAllByRole("listitem")
      .map((li) => li.querySelector("h3")?.textContent),
  ).toEqual(["Log the enquiry", "Search every supplier", "Send the quote"]);
  expect(within(steps).getAllByRole("listitem")[2]).not.toHaveTextContent(/next release/i);

  const security = screen.getByRole("region", { name: "Security and data handling" });
  expect(
    within(security)
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent),
  ).toEqual(["Each agency's data kept apart", "Owner, admin and agent roles", "Audit log", "Passwords and sessions", "Provenance on every price"]);
  expect(within(security).getByText("Tenant isolation policy")).toBeInTheDocument();

  const faq = screen.getByRole("region", { name: "Questions agencies ask" });
  const questions = within(faq)
    .getAllByRole("term")
    .map((term) => term.textContent);
  expect(questions).toHaveLength(6);
  expect(questions).toContain("Which currencies are supported?");
  expect(within(faq).getByText(/works in INR or USD/)).toBeInTheDocument();
  expect(within(faq).getByText(/deleted after 7 days/)).toBeInTheDocument();

  const footer = screen.getByRole("contentinfo");
  expect(footer).toHaveTextContent("© 2026 TravelMind");
  const footerNav = within(footer).getByRole("navigation", { name: "Footer" });
  expect(within(footerNav).getByRole("link", { name: /^Sign in/ })).toHaveAttribute("href", "/login");
  expect(within(footerNav).getByRole("link", { name: /^Create workspace/ })).toHaveAttribute("href", "/signup");
  expect(within(footerNav).getByRole("link", { name: /^Open demo workspace/ })).toHaveAttribute("href", "/demo");
  expect(within(footerNav).getByRole("link", { name: "Security" })).toHaveAttribute("href", "#security");
  expect(within(footerNav).getByRole("link", { name: "FAQ" })).toHaveAttribute("href", "#faq");
});

test("the page has a descriptive title", async () => {
  mockApi(withSession(null, { "GET /api/v1/platform/facts": { status: 200, body: FACTS } }));
  renderApp("/");
  await screen.findByRole("heading", { level: 1 });
  await waitFor(() => expect(document.title).toBe("TravelMind — Operations console for travel agencies"));
});

test("the page sets its own search description, since the shared page shell stays neutral", async () => {
  mockApi(withSession(null, { "GET /api/v1/platform/facts": { status: 200, body: FACTS } }));
  const { unmount } = renderApp("/");
  await screen.findByRole("heading", { level: 1 });
  const description = () => document.head.querySelector('meta[name="description"]')?.getAttribute("content");
  await waitFor(() => expect(description()).toMatch(/^TravelMind is the operations console for travel agencies/));
  unmount();
  expect(description() ?? "").not.toMatch(/operations console/);
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

const HEADLINE = { level: 1, name: "Answer travel enquiries with fares you can explain" } as const;

test("a failing session check still shows the landing page", async () => {
  mockApi({
    "GET /api/v1/auth/me": { status: 500, body: { detail: "Something went wrong on our side." } },
    "GET /api/v1/platform/facts": { status: 200, body: FACTS },
  });
  renderApp("/");
  expect(await screen.findByRole("heading", HEADLINE)).toBeInTheDocument();
});

test("a hanging session check shows the landing page after a short wait", async () => {
  mockApi({
    "GET /api/v1/auth/me": () => new Promise(() => {}),
    "GET /api/v1/platform/facts": { status: 200, body: FACTS },
  });
  renderApp("/");
  expect(await screen.findByRole("heading", HEADLINE, { timeout: 6000 })).toBeInTheDocument();
}, 10_000);
