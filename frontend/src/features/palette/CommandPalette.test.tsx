import { screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { AIRPORTS, ME_OWNER } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { renderApp, withSession } from "../../test/renderApp";
import { initTheme } from "../../theme";
import { routeStore } from "../route/routeStore";

vi.mock("../globe/webgl", () => ({ hasWebGL: () => false }));

beforeEach(() => {
  routeStore.reset();
  initTheme();
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/team": { status: 200, body: [] },
      "GET /api/v1/invitations": { status: 200, body: [] },
      "GET /api/v1/reference/airports": { status: 200, body: [AIRPORTS.GOI, AIRPORTS.GOX] },
      "GET /api/v1/search": { status: 200, body: { clients: [], enquiries: [], quotes: [] } },
    }),
  );
});

test("Ctrl+K opens the palette and Escape closes it", async () => {
  const { user } = renderApp("/app");
  await screen.findByRole("banner");
  await user.keyboard("{Control>}k{/Control}");
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

test("⌘K opens it too, and the top bar search field does", async () => {
  const { user } = renderApp("/app");
  await screen.findByRole("banner");
  await user.keyboard("{Meta>}k{/Meta}");
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: /search clients, enquiries, quotes/i }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
});

test("typing a command and pressing Enter navigates", async () => {
  const { user, router } = renderApp("/app");
  await screen.findByRole("banner");
  await user.keyboard("{Control>}k{/Control}");
  await user.type(await screen.findByPlaceholderText(/command or an airport/i), "crew");
  await user.keyboard("{Enter}");
  await waitFor(() => expect(router.state.location.pathname).toBe("/app/team"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("the hotel and supplier commands navigate", async () => {
  const { user, router } = renderApp("/app");
  await screen.findByRole("banner");
  await user.keyboard("{Control>}k{/Control}");
  await user.type(await screen.findByPlaceholderText(/command or an airport/i), "accommodation");
  await user.keyboard("{Enter}");
  await waitFor(() => expect(router.state.location.pathname).toBe("/app/hotels"));
  await user.keyboard("{Control>}k{/Control}");
  await user.type(await screen.findByPlaceholderText(/command or an airport/i), "liteapi");
  await user.keyboard("{Enter}");
  await waitFor(() => expect(router.state.location.pathname).toBe("/app/suppliers"));
});

test.each([
  ["pipeline", "/app/pipeline"],
  ["kanban", "/app/pipeline"],
  ["quotes", "/app/quotes"],
  ["proposals", "/app/quotes"],
  ["travellers", "/app/clients"],
  ["route intel", "/app/routes"],
  ["fare history", "/app/routes"],
  ["branding", "/app/settings"],
])("the command for %s navigates to %s", async (term, path) => {
  const { user, router } = renderApp("/app");
  await screen.findByRole("banner");
  await user.keyboard("{Control>}k{/Control}");
  await user.type(await screen.findByPlaceholderText(/command or an airport/i), term);
  await user.keyboard("{Enter}");
  await waitFor(() => expect(router.state.location.pathname).toBe(path));
});

test("the mode command switches between dark and light", async () => {
  const { user } = renderApp("/app");
  await screen.findByRole("banner");
  await user.keyboard("{Control>}k{/Control}");
  await user.type(await screen.findByPlaceholderText(/command or an airport/i), "daylight");
  await user.keyboard("{Enter}");
  expect(document.documentElement.dataset.mode).toBe("light");
});

test("choosing an airport sets it on the route and returns to the Command Center", async () => {
  const { user, router } = renderApp("/app/team");
  await screen.findByRole("banner");
  await user.keyboard("{Control>}k{/Control}");
  await user.type(await screen.findByPlaceholderText(/command or an airport/i), "goa");
  await screen.findByRole("option", { name: /GOI/ });
  await user.keyboard("{Enter}");
  expect(routeStore.get().origin?.iata_code).toBe("GOI");
  await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
});

test("airport results from an earlier term cannot be chosen", async () => {
  const { user, router } = renderApp("/app/team");
  await screen.findByRole("banner");
  await user.keyboard("{Control>}k{/Control}");
  const input = await screen.findByPlaceholderText(/command or an airport/i);
  await user.type(input, "goa");
  await screen.findByRole("option", { name: /GOI/ });
  await user.type(input, "n");
  await user.keyboard("{Enter}");
  expect(routeStore.get()).toEqual({ origin: null, destination: null });
  // Let the new term's results settle: still nothing was placed and the palette stayed put.
  await screen.findByRole("option", { name: /GOI/ });
  expect(routeStore.get()).toEqual({ origin: null, destination: null });
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/app/team");
});

test("a failed airport lookup says so instead of offering choices", async () => {
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/reference/airports": { status: 503, body: { detail: "Airport data is unavailable." } },
    }),
  );
  const { user } = renderApp("/app");
  await screen.findByRole("banner");
  await user.keyboard("{Control>}k{/Control}");
  await user.type(await screen.findByPlaceholderText(/command or an airport/i), "goa");
  expect(await screen.findByRole("alert")).toHaveTextContent("Airport data is unavailable.");
  expect(screen.queryByRole("option")).not.toBeInTheDocument();
});

test("closing with Ctrl+K clears the search, so reopening starts fresh", async () => {
  const { user } = renderApp("/app");
  await screen.findByRole("banner");
  await user.keyboard("{Control>}k{/Control}");
  await user.type(await screen.findByPlaceholderText(/command or an airport/i), "crew");
  expect(screen.getAllByRole("option")).toHaveLength(1);
  await user.keyboard("{Control>}k{/Control}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await user.keyboard("{Control>}k{/Control}");
  expect(await screen.findByPlaceholderText(/command or an airport/i)).toHaveValue("");
  for (const name of [
    "Command Center",
    "Pipeline",
    "Quotes",
    "Clients",
    "Agent",
    "Fare search",
    "Hotel search",
    "Route intel",
    "Suppliers",
    "Team",
    "Settings",
    "Design system",
    "Plan a trip with the agent",
    "Switch to light mode",
    "Sign out",
  ]) {
    expect(screen.getByRole("option", { name })).toBeInTheDocument();
  }
});

test("Plan a trip with the agent opens the Agent", async () => {
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/agent/availability": { status: 200, body: { available: true, provider: "fake", model: "demo-planner", demo: true } },
      "GET /api/v1/agent/runs": { status: 200, body: { items: [] } },
    }),
  );
  const { user, router } = renderApp("/app");
  await screen.findByRole("banner");
  await user.keyboard("{Control>}k{/Control}");
  await user.type(await screen.findByPlaceholderText(/command or an airport/i), "plan a trip");
  await user.click(await screen.findByRole("option", { name: "Plan a trip with the agent" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/app/agent"));
});
