import { screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ME_DEMO, ME_OWNER } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { renderApp, withSession } from "../../test/renderApp";
import { commandCenterMocks } from "../../test/workspaceFixtures";

vi.mock("../globe/webgl", () => ({ hasWebGL: () => false }));

test("demo launch signs in and opens the command center", async () => {
  mockApi(withSession(null, { "POST /api/v1/demo": { status: 201, body: ME_DEMO }, ...commandCenterMocks({ populated: true }) }));
  const { router } = renderApp("/demo");
  // Brief said getByText: the router matches its first location in an effect, after render() returns.
  expect(await screen.findByText("Preparing your demo workspace…")).toBeInTheDocument();
  await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
});

test("demo rate limit is explained", async () => {
  mockApi(withSession(null, { "POST /api/v1/demo": { status: 429, body: { detail: "Too many demo workspaces from your network. Please try again later." } } }));
  renderApp("/demo");
  expect(await screen.findByRole("alert")).toHaveTextContent("Too many demo workspaces");
  expect(screen.getByRole("link", { name: "Create a workspace instead" })).toHaveAttribute("href", "/signup");
});

test("the demo workspace is created once and its user is signed in from the response", async () => {
  let release!: () => void;
  const created = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { calls } = mockApi(
    withSession(null, {
      "POST /api/v1/demo": async () => {
        await created;
        return { status: 201, body: ME_DEMO };
      },
      ...commandCenterMocks({ populated: true }),
    }),
  );
  const { router, queryClient } = renderApp("/demo");
  expect(await screen.findByRole("heading", { level: 1, name: "Preparing your demo workspace…" })).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "Preparing your demo workspace" })).toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Demo setup steps" })).toBeInTheDocument();
  await waitFor(() => expect(calls.some((c) => c.path === "/api/v1/demo")).toBe(true));
  expect(router.state.location.pathname).toBe("/demo");
  release();
  await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
  expect(queryClient.getQueryData(["me"])).toEqual(ME_DEMO);
  expect(await screen.findByText("Demo")).toBeInTheDocument();
  expect(calls.filter((c) => c.method === "POST" && c.path === "/api/v1/demo")).toHaveLength(1);
});

test("other demo failures offer a retry", async () => {
  let attempts = 0;
  mockApi(
    withSession(null, {
      "POST /api/v1/demo": () => {
        attempts += 1;
        return attempts === 1
          ? { status: 503, body: { detail: "Demo workspaces are unavailable right now." } }
          : { status: 201, body: ME_DEMO };
      },
      ...commandCenterMocks({ populated: true }),
    }),
  );
  const { router, user } = renderApp("/demo");
  expect(await screen.findByRole("alert")).toHaveTextContent("Demo workspaces are unavailable right now.");
  expect(screen.queryByRole("link", { name: "Create a workspace instead" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
  expect(attempts).toBe(2);
});

test("signed-in visitors keep their session and go straight to the app", async () => {
  const { calls } = mockApi(withSession(ME_OWNER, { ...commandCenterMocks() }));
  const { router } = renderApp("/demo");
  await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
  expect(calls.some((c) => c.path === "/api/v1/demo")).toBe(false);
});
