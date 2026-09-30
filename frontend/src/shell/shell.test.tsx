import { render, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ApiError } from "../api/client";
import { RouteError } from "../app/RouteError";
import { ME_OWNER } from "../test/fixtures";
import { mockApi } from "../test/mockApi";
import { renderApp, withSession } from "../test/renderApp";
import { commandCenterMocks } from "../test/workspaceFixtures";

test("the shell shows the agency, the user and navigation", async () => {
  mockApi(withSession(ME_OWNER));
  renderApp("/app");
  const banner = await screen.findByRole("banner");
  expect(within(banner).getByText("Alpha Travels")).toBeInTheDocument();
  expect(within(banner).getByText("Asha Rao")).toBeInTheDocument();
  expect(within(banner).getByText("owner")).toBeInTheDocument();
  const nav = screen.getByRole("navigation", { name: "Primary" });
  for (const name of ["Command Center", "Fare search", "Hotel search", "Suppliers", "Team", "Design system"]) {
    expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
  }
});

test("status bar reports a healthy API and both clocks", async () => {
  mockApi(withSession(ME_OWNER));
  renderApp("/app");
  expect(await screen.findByText("API online")).toBeInTheDocument();
  expect(screen.getByText(/^UTC \d{2}:\d{2}:\d{2}$/)).toBeInTheDocument();
  expect(screen.getByText(/^IST \d{2}:\d{2}:\d{2}$/)).toBeInTheDocument();
});

test("status bar reports a degraded API", async () => {
  mockApi({
    ...withSession(ME_OWNER),
    "GET /health": { status: 503, body: { status: "degraded", database: "unavailable" } },
  });
  renderApp("/app");
  expect(await screen.findByText("API degraded")).toBeInTheDocument();
});

test("signing out clears the session and returns to login", async () => {
  const { calls } = mockApi(
    withSession(ME_OWNER, { ...commandCenterMocks(), "POST /api/v1/auth/logout": { status: 204 } }),
  );
  const { router, user } = renderApp("/app");
  await user.click(await screen.findByRole("button", { name: "Asha Rao" }));
  await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  expect(calls.some((c) => c.method === "POST" && c.path === "/api/v1/auth/logout")).toBe(true);
  expect(await screen.findByRole("heading", { name: "Sign in to TravelMind" })).toBeInTheDocument();
});

test("the design gallery is reachable inside the shell", async () => {
  mockApi(withSession(ME_OWNER));
  const { user, router } = renderApp("/app");
  await user.click(await screen.findByRole("link", { name: "Design system" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/app/design"));
  expect(screen.getByRole("heading", { name: "Colour tokens" })).toBeInTheDocument();
});

test("the scanners and suppliers are reachable from the navigation", async () => {
  mockApi(withSession(ME_OWNER));
  const { user, router } = renderApp("/app");
  await user.click(await screen.findByRole("link", { name: "Hotel search" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/app/hotels"));
  expect(screen.getByRole("heading", { level: 1, name: "Hotel search" })).toBeInTheDocument();
  await user.click(screen.getByRole("link", { name: "Fare search" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/app/fares"));
  await user.click(screen.getByRole("link", { name: "Suppliers" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/app/suppliers"));
});

test("unknown pages show a way home", async () => {
  mockApi(withSession(ME_OWNER));
  renderApp("/nowhere");
  expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Return to Command Center" })).toBeInTheDocument();
});

test("a failing route shows the error with its trace ID instead of a blank screen", () => {
  const reset = vi.fn();
  render(
    <RouteError
      error={new ApiError(500, "Something went wrong on our side. Please try again.", {}, "trace-42")}
      reset={reset}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong on our side. Please try again.");
  expect(screen.getByText("Trace ID: trace-42")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

test("Try again recovers once the failing request succeeds", async () => {
  let meCalls = 0;
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/auth/me": () => {
        meCalls += 1;
        return meCalls === 1
          ? { status: 500, body: { detail: "Something went wrong on our side. Please try again.", trace_id: "trace-77" } }
          : { status: 200, body: ME_OWNER };
      },
    }),
  );
  const { user } = renderApp("/app");
  expect(await screen.findByText("Trace ID: trace-77")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("banner")).toHaveTextContent("Alpha Travels");
  expect(screen.queryByText("Trace ID: trace-77")).not.toBeInTheDocument();
});
