import { screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { AIRPORTS, ME_OWNER } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { renderApp, withSession } from "../../test/renderApp";
import { initTheme } from "../../ui/theme";
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
    }),
  );
});

test("Ctrl+K opens the palette and Escape closes it", async () => {
  const { user } = renderApp("/");
  await screen.findByRole("banner");
  await user.keyboard("{Control>}k{/Control}");
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

test("⌘K opens it too, and the header button does", async () => {
  const { user } = renderApp("/");
  await screen.findByRole("banner");
  await user.keyboard("{Meta>}k{/Meta}");
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: /command palette/i }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
});

test("typing a command and pressing Enter navigates", async () => {
  const { user, router } = renderApp("/");
  await screen.findByRole("banner");
  await user.keyboard("{Control>}k{/Control}");
  await user.type(await screen.findByPlaceholderText(/command or an airport/i), "crew");
  await user.keyboard("{Enter}");
  await waitFor(() => expect(router.state.location.pathname).toBe("/team"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("the theme command switches themes", async () => {
  const { user } = renderApp("/");
  await screen.findByRole("banner");
  await user.keyboard("{Control>}k{/Control}");
  await user.type(await screen.findByPlaceholderText(/command or an airport/i), "daylight");
  await user.keyboard("{Enter}");
  expect(document.documentElement.dataset.theme).toBe("daylight");
});

test("choosing an airport sets it on the route and returns to Mission Control", async () => {
  const { user, router } = renderApp("/team");
  await screen.findByRole("banner");
  await user.keyboard("{Control>}k{/Control}");
  await user.type(await screen.findByPlaceholderText(/command or an airport/i), "goa");
  await screen.findByRole("option", { name: /GOI/ });
  await user.keyboard("{Enter}");
  expect(routeStore.get().origin?.iata_code).toBe("GOI");
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
});

test("airport results from an earlier term cannot be chosen", async () => {
  const { user, router } = renderApp("/team");
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
  expect(router.state.location.pathname).toBe("/team");
});

test("a failed airport lookup says so instead of offering choices", async () => {
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/reference/airports": { status: 503, body: { detail: "Airport data is unavailable." } },
    }),
  );
  const { user } = renderApp("/");
  await screen.findByRole("banner");
  await user.keyboard("{Control>}k{/Control}");
  await user.type(await screen.findByPlaceholderText(/command or an airport/i), "goa");
  expect(await screen.findByRole("alert")).toHaveTextContent("Airport data is unavailable.");
  expect(screen.queryByRole("option")).not.toBeInTheDocument();
});
