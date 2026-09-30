import { render, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ApiError } from "../api/client";
import { RouteError } from "../app/RouteError";
import { ME_OWNER } from "../test/fixtures";
import { mockApi } from "../test/mockApi";
import { renderApp, withSession } from "../test/renderApp";

test("the shell shows the agency, the user and navigation", async () => {
  mockApi(withSession(ME_OWNER));
  renderApp("/");
  const banner = await screen.findByRole("banner");
  expect(within(banner).getByText("Alpha Travels")).toBeInTheDocument();
  expect(within(banner).getByText("Asha Rao")).toBeInTheDocument();
  expect(within(banner).getByText("owner")).toBeInTheDocument();
  const nav = screen.getByRole("navigation", { name: "Primary" });
  for (const name of ["Mission Control", "Fare scan", "Hotel scan", "Suppliers", "Crew roster", "Design system"]) {
    expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
  }
});

test("status bar reports a healthy API and both clocks", async () => {
  mockApi(withSession(ME_OWNER));
  renderApp("/");
  expect(await screen.findByText("API online")).toBeInTheDocument();
  expect(screen.getByText(/^UTC \d{2}:\d{2}:\d{2}$/)).toBeInTheDocument();
  expect(screen.getByText(/^IST \d{2}:\d{2}:\d{2}$/)).toBeInTheDocument();
});

test("status bar reports a degraded API", async () => {
  mockApi({
    ...withSession(ME_OWNER),
    "GET /health": { status: 503, body: { status: "degraded", database: "unavailable" } },
  });
  renderApp("/");
  expect(await screen.findByText("API degraded")).toBeInTheDocument();
});

test("signing out clears the session and returns to login", async () => {
  const { calls } = mockApi(withSession(ME_OWNER, { "POST /api/v1/auth/logout": { status: 204 } }));
  const { router, user } = renderApp("/");
  await user.click(await screen.findByRole("button", { name: "Sign out" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  expect(calls.some((c) => c.method === "POST" && c.path === "/api/v1/auth/logout")).toBe(true);
  expect(await screen.findByRole("heading", { name: "Mission access" })).toBeInTheDocument();
});

test("the design gallery is reachable inside the shell", async () => {
  mockApi(withSession(ME_OWNER));
  const { user, router } = renderApp("/");
  await user.click(await screen.findByRole("link", { name: "Design system" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/design"));
  expect(screen.getByRole("heading", { name: "Colour tokens" })).toBeInTheDocument();
});

test("the scanners and suppliers are reachable from the navigation", async () => {
  mockApi(withSession(ME_OWNER));
  const { user, router } = renderApp("/");
  await user.click(await screen.findByRole("link", { name: "Hotel scan" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/hotels"));
  expect(screen.getByRole("heading", { name: "Find a stay" })).toBeInTheDocument();
  await user.click(screen.getByRole("link", { name: "Fare scan" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/fares"));
  await user.click(screen.getByRole("link", { name: "Suppliers" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/suppliers"));
});

test("unknown pages show a way home", async () => {
  mockApi(withSession(ME_OWNER));
  renderApp("/nowhere");
  expect(await screen.findByRole("heading", { name: "Signal lost" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Return to Mission Control" })).toBeInTheDocument();
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
  const { user } = renderApp("/");
  expect(await screen.findByText("Trace ID: trace-77")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("banner")).toHaveTextContent("Alpha Travels");
  expect(screen.queryByText("Trace ID: trace-77")).not.toBeInTheDocument();
});
