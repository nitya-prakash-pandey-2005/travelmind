import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { routeStore } from "../features/route/routeStore";
import { ME_DEMO, ME_OWNER } from "../test/fixtures";
import { mockApi } from "../test/mockApi";
import { renderApp, withSession } from "../test/renderApp";
import { commandCenterMocks } from "../test/workspaceFixtures";

vi.mock("../features/globe/webgl", () => ({ hasWebGL: () => false }));

beforeEach(() => routeStore.reset());

const SEARCH_RESULTS = {
  clients: [{ id: "c1", name: "Priya Sharma", email: "priya@example.com", company_name: "Sharma Exports" }],
  enquiries: [{ id: "e1", number: "E-0002", origin: "DEL", destination: "GOI", status: "quoting" }],
  quotes: [{ id: "q1", number: "Q-0004", status: "viewed", client_name: "Priya Sharma" }],
};

test("signed-in visitors at / land in the app", async () => {
  mockApi(withSession(ME_OWNER, { ...commandCenterMocks() }));
  const { router } = renderApp("/");
  await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
});

test("signed-out visitors at / stay on the public page", async () => {
  mockApi(withSession(null));
  const { router } = renderApp("/");
  expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  expect(router.state.location.pathname).toBe("/");
});

test("legacy paths redirect under /app", async () => {
  mockApi(withSession(ME_OWNER, { ...commandCenterMocks() }));
  const { router } = renderApp("/fares");
  await waitFor(() => expect(router.state.location.pathname).toBe("/app/fares"));
});

test("legacy redirects keep the query string", async () => {
  mockApi(withSession(ME_OWNER, { ...commandCenterMocks(), "GET /api/v1/team": { status: 200, body: [] } }));
  const { router } = renderApp("/team?tab=crew");
  await waitFor(() => expect(router.state.location.pathname).toBe("/app/team"));
  expect(router.state.location.search).toEqual({ tab: "crew" });
});

test("grouped navigation and collapse", async () => {
  mockApi(withSession(ME_OWNER, { ...commandCenterMocks() }));
  const { user } = renderApp("/app");
  const nav = await screen.findByRole("navigation", { name: "Primary" });
  for (const name of ["Command Center", "Fare scan", "Hotel scan", "Crew roster", "Suppliers", "Design system"]) {
    expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
  }
  await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
  expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute("aria-expanded", "false");
});

test("navigation is grouped under Operate, Market and Admin, and the collapse is remembered", async () => {
  mockApi(withSession(ME_OWNER, { ...commandCenterMocks() }));
  const { user, unmount } = renderApp("/app");
  const nav = await screen.findByRole("navigation", { name: "Primary" });
  expect(within(nav).getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
    "Operate",
    "Market",
    "Admin",
  ]);
  expect(within(nav).getByRole("link", { name: "Command Center" })).toHaveAttribute("aria-current", "page");
  expect(within(nav).getByRole("link", { name: "Crew roster" })).toHaveAttribute("href", "/app/team");
  expect(screen.getByRole("button", { name: "Collapse sidebar" })).toHaveAttribute("aria-expanded", "true");
  await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
  expect(window.localStorage.getItem("tm-sidebar")).toBe("collapsed");
  unmount();

  renderApp("/app");
  expect(await screen.findByRole("button", { name: "Expand sidebar" })).toHaveAttribute("aria-expanded", "false");
});

test("demo workspace is badged and can be exited", async () => {
  const { calls } = mockApi(withSession(ME_DEMO, { ...commandCenterMocks(), "POST /api/v1/demo/exit": { status: 204 } }));
  const { user, router } = renderApp("/app");
  expect(await screen.findByText("DEMO WORKSPACE")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Exit demo" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(calls.some((c) => c.path === "/api/v1/demo/exit")).toBe(true);
});

test("if leaving the demo fails, it says so and keeps the workspace", async () => {
  mockApi(
    withSession(ME_DEMO, {
      ...commandCenterMocks(),
      "POST /api/v1/demo/exit": { status: 500, body: { detail: "Boom" } },
    }),
  );
  const { user, router, queryClient } = renderApp("/app");
  const banner = await screen.findByRole("region", { name: "Demo workspace" });
  await user.click(within(banner).getByRole("button", { name: "Exit demo" }));
  const toast = await screen.findByText("Couldn't leave the demo. Try again.");
  expect(toast.closest('[aria-live="assertive"]')).not.toBeNull(); // a danger toast
  expect(router.state.location.pathname).toBe("/app");
  expect(queryClient.getQueryData(["me"])).toEqual(ME_DEMO);
  expect(within(banner).getByRole("button", { name: "Exit demo" })).toBeEnabled();
});

test("the demo banner says when the workspace is deleted, and exiting forgets the demo's data", async () => {
  const expires = new Date(Date.now() + 3 * 86_400_000 - 3_600_000).toISOString();
  mockApi(
    withSession(ME_DEMO, {
      ...commandCenterMocks(),
      "GET /api/v1/agency": {
        status: 200,
        body: { ...ME_DEMO.agency, demo_expires_at: expires },
      },
      "POST /api/v1/demo/exit": { status: 204 },
    }),
  );
  const { user, router, queryClient } = renderApp("/app");
  expect(
    await screen.findByText("You're exploring a demo workspace with sample data. It's deleted automatically in 3 days."),
  ).toBeInTheDocument();
  await waitFor(() => expect(queryClient.getQueryData(["notifications"])).toBeDefined());
  await user.click(screen.getByRole("button", { name: "Exit demo" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(queryClient.getQueryData(["me"])).toBeNull();
  expect(queryClient.getQueryData(["notifications"])).toBeUndefined();
  expect(queryClient.getQueryData(["agency"])).toBeUndefined();
  expect(screen.queryByText("DEMO WORKSPACE")).not.toBeInTheDocument();
  expect(await screen.findByRole("link", { name: "Sign in" })).toBeInTheDocument();
});

test("a regular workspace has no demo badge or banner", async () => {
  const { calls } = mockApi(withSession(ME_OWNER, { ...commandCenterMocks() }));
  renderApp("/app");
  const banner = await screen.findByRole("banner");
  expect(within(banner).getByText("Alpha Travels")).toBeInTheDocument();
  expect(within(banner).getByText("AT")).toBeInTheDocument();
  expect(screen.queryByText("DEMO WORKSPACE")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Exit demo" })).not.toBeInTheDocument();
  expect(calls.some((c) => c.path === "/api/v1/agency")).toBe(false);
});

test("notifications show unread and mark seen up to the newest one shown", async () => {
  const { calls } = mockApi(withSession(ME_OWNER, { ...commandCenterMocks(),
    "GET /api/v1/notifications": { status: 200, body: { unread: 2, items: [
      { id: "n2", kind: "quote.viewed", summary: "Priya viewed Q-0004", occurred_at: "2026-09-30T08:00:00.123456Z", read: false },
      { id: "n1", kind: "team.joined", summary: "Ravi joined the team", occurred_at: "2026-09-29T08:00:00Z", read: false },
    ] } },
    "POST /api/v1/notifications/seen": { status: 204 } }));
  const { user } = renderApp("/app");
  await user.click(await screen.findByRole("button", { name: "Notifications, 2 unread" }));
  expect(screen.getByText("Priya viewed Q-0004")).toBeInTheDocument();
  await waitFor(() => expect(calls.some((c) => c.path === "/api/v1/notifications/seen")).toBe(true));
  // Anything that arrives after the list was shown stays unread.
  expect(calls.find((c) => c.path === "/api/v1/notifications/seen")?.body).toEqual({
    until: "2026-09-30T08:00:00.123456Z",
  });
});

test("marking notifications seen refreshes the count, and Escape closes the list", async () => {
  let seen = false;
  const item = { id: "n1", kind: "quote.accepted", summary: "Priya accepted Q-0004", occurred_at: "2026-09-30T08:00:00Z" };
  mockApi(
    withSession(ME_OWNER, {
      ...commandCenterMocks(),
      "GET /api/v1/notifications": () => ({
        status: 200,
        body: { unread: seen ? 0 : 1, items: [{ ...item, read: seen }] },
      }),
      "POST /api/v1/notifications/seen": () => {
        seen = true;
        return { status: 204 };
      },
    }),
  );
  const { user } = renderApp("/app");
  const bell = await screen.findByRole("button", { name: "Notifications, 1 unread" });
  await user.click(bell);
  expect(bell).toHaveAttribute("aria-expanded", "true");
  await waitFor(() => expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument());
  await user.keyboard("{Escape}");
  expect(screen.queryByText("Priya accepted Q-0004")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Notifications" })).toHaveFocus();
});

test("no notifications shows an all-clear", async () => {
  mockApi(withSession(ME_OWNER, { ...commandCenterMocks() }));
  const { user } = renderApp("/app");
  await user.click(await screen.findByRole("button", { name: "Notifications" }));
  const list = screen.getByRole("region", { name: "Notifications" });
  expect(within(list).getByText("You're all caught up.")).toBeInTheDocument();
});

test("sign out lives in the user menu", async () => {
  const { calls } = mockApi(
    withSession(ME_OWNER, { ...commandCenterMocks(), "POST /api/v1/auth/logout": { status: 204 } }),
  );
  const { user, router, queryClient } = renderApp("/app");
  await user.click(await screen.findByRole("button", { name: "Asha Rao" }));
  const menu = screen.getByRole("menu");
  expect(within(menu).getByRole("menuitem", { name: "Design system" })).toBeInTheDocument();
  expect(within(menu).queryByRole("menuitem", { name: "Settings" })).not.toBeInTheDocument();
  await user.click(within(menu).getByRole("menuitem", { name: "Sign out" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  expect(calls.some((c) => c.method === "POST" && c.path === "/api/v1/auth/logout")).toBe(true);
  expect(queryClient.getQueryData(["notifications"])).toBeUndefined();
  expect(queryClient.getQueryData(["suppliers"])).toBeUndefined();
});

test("the top bar search opens the command palette", async () => {
  mockApi(withSession(ME_OWNER, { ...commandCenterMocks() }));
  const { user } = renderApp("/app");
  const trigger = await screen.findByRole("button", { name: /Search clients, quotes, airports/ });
  expect(trigger).toHaveAttribute("aria-keyshortcuts", "Control+K Meta+K");
  expect(within(trigger).getByText("Ctrl K")).toBeInTheDocument();
  await user.click(trigger);
  expect(await screen.findByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
});

test("palette finds clients, enquiries and quotes", async () => {
  const { calls } = mockApi(
    withSession(ME_OWNER, {
      ...commandCenterMocks(),
      "GET /api/v1/search": { status: 200, body: SEARCH_RESULTS },
      "GET /api/v1/reference/airports": { status: 200, body: [] },
    }),
  );
  const { user } = renderApp("/app");
  await screen.findByRole("banner");
  await user.keyboard("{Control>}k{/Control}");
  await user.type(await screen.findByPlaceholderText(/command or an airport/i), "pri");
  const clients = await screen.findByRole("group", { name: "Clients" });
  expect(within(clients).getByRole("option", { name: /Priya Sharma/ })).toBeInTheDocument();
  expect(within(screen.getByRole("group", { name: "Enquiries" })).getByRole("option", { name: /E-0002/ })).toBeInTheDocument();
  expect(within(screen.getByRole("group", { name: "Quotes" })).getByRole("option", { name: /Q-0004/ })).toBeInTheDocument();
  expect(calls.find((c) => c.path === "/api/v1/search")?.search.get("q")).toBe("pri");
});

test("a one-letter term doesn't search records", async () => {
  const { calls } = mockApi(withSession(ME_OWNER, { ...commandCenterMocks() }));
  const { user } = renderApp("/app");
  await screen.findByRole("banner");
  await user.keyboard("{Control>}k{/Control}");
  await user.type(await screen.findByPlaceholderText(/command or an airport/i), "p");
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(calls.some((c) => c.path === "/api/v1/search")).toBe(false);
});

test.each([
  ["Clients", /Priya Sharma/, "Priya Sharma", ["priya@example.com", "Sharma Exports"]],
  ["Enquiries", /E-0002/, "E-0002", ["DEL → GOI", "Quoting"]],
  ["Quotes", /Q-0004/, "Q-0004", ["Viewed", "Priya Sharma"]],
])("choosing a record from %s opens it in a drawer", async (group, option, title, facts) => {
  mockApi(withSession(ME_OWNER, { ...commandCenterMocks(), "GET /api/v1/search": { status: 200, body: SEARCH_RESULTS } }));
  const { user } = renderApp("/app");
  await screen.findByRole("banner");
  await user.keyboard("{Control>}k{/Control}");
  await user.type(await screen.findByPlaceholderText(/command or an airport/i), "pri");
  const records = await screen.findByRole("group", { name: group });
  await user.click(within(records).getByRole("option", { name: option }));
  const drawer = await screen.findByRole("dialog", { name: title });
  for (const fact of facts) expect(drawer).toHaveTextContent(fact);
  expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
  await user.click(within(drawer).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: title })).not.toBeInTheDocument());
});

test("palette navigation covers every sidebar item", async () => {
  mockApi(withSession(ME_OWNER, { ...commandCenterMocks() }));
  const { user } = renderApp("/app");
  await screen.findByRole("banner");
  await user.keyboard("{Control>}k{/Control}");
  const navigate = await screen.findByRole("group", { name: "Navigate" });
  for (const name of ["Command Center", "Fare scan", "Hotel scan", "Crew roster", "Suppliers", "Design system"]) {
    expect(within(navigate).getByRole("option", { name })).toBeInTheDocument();
  }
});

test("the status bar shows agency time and connected suppliers", async () => {
  mockApi(withSession(ME_OWNER, { ...commandCenterMocks() }));
  renderApp("/app");
  const footer = await screen.findByRole("contentinfo");
  expect(await within(footer).findByText("1 supplier connected")).toBeInTheDocument();
  expect(within(footer).getByText(/^IST \d{2}:\d{2}:\d{2}$/)).toBeInTheDocument();
  expect(within(footer).getByText(/^UTC \d{2}:\d{2}:\d{2}$/)).toBeInTheDocument();
});

test("the agency clock follows the agency's timezone", async () => {
  const london = { ...ME_OWNER, agency: { ...ME_OWNER.agency, country_code: "GB", timezone: "Europe/London" } };
  mockApi(withSession(london, { ...commandCenterMocks() }));
  renderApp("/app");
  const footer = await screen.findByRole("contentinfo");
  expect(within(footer).getByText(/^(GMT|BST) \d{2}:\d{2}:\d{2}$/)).toBeInTheDocument();
  expect(within(footer).queryByText(/^IST /)).not.toBeInTheDocument();
});

test("Ctrl+K does nothing while a record drawer is open", async () => {
  mockApi(withSession(ME_OWNER, { ...commandCenterMocks(), "GET /api/v1/search": { status: 200, body: SEARCH_RESULTS } }));
  const { user } = renderApp("/app");
  await screen.findByRole("banner");
  await user.keyboard("{Control>}k{/Control}");
  await user.type(await screen.findByPlaceholderText(/command or an airport/i), "pri");
  await user.click(within(await screen.findByRole("group", { name: "Clients" })).getByRole("option", { name: /Priya/ }));
  expect(await screen.findByRole("dialog", { name: "Priya Sharma" })).toBeInTheDocument();
  await user.keyboard("{Control>}k{/Control}");
  expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
});
