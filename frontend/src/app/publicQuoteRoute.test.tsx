import { screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { mockApi } from "../test/mockApi";
import { renderApp, withSession } from "../test/renderApp";

vi.mock("../features/globe/webgl", () => ({ hasWebGL: () => false }));

const QUOTE = {
  number: "Q-0004",
  status: "sent",
  agency: { name: "Orbit Travel Co.", brand_color: "#0B84C6" },
  client_first_name: "Priya",
  message: "",
  options: [],
  currency: "INR",
  expires_at: "2026-10-17T09:00:00Z",
  decided_at: null,
  accepted_option: null,
};

test("the client's quote link opens through the app router, with no app shell and no session", async () => {
  const { calls } = mockApi(withSession(null, { "GET /api/v1/public/quotes/tok_abc": { status: 200, body: QUOTE } }));
  const { router } = renderApp("/q/tok_abc");
  expect(await screen.findByRole("heading", { level: 1, name: "Hello Priya," })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/q/tok_abc");
  expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
  expect(screen.queryByPlaceholderText(/Search clients/)).not.toBeInTheDocument();
  expect(calls.some((call) => call.path === "/api/v1/public/quotes/tok_abc")).toBe(true);
  // The page never asks who is signed in, and a signed-out visitor stays on it.
  expect(calls.some((call) => call.path === "/api/v1/auth/me")).toBe(false);
});
