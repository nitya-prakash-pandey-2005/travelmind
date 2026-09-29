import { screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { ME_OWNER } from "../test/fixtures";
import { mockApi } from "../test/mockApi";
import { renderApp, withSession } from "../test/renderApp";

test("signed-out visitors are sent to login with a return path", async () => {
  mockApi(withSession(null));
  const { router } = renderApp("/team");
  expect(await screen.findByRole("heading", { name: "Mission access" })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/login");
  expect(router.state.location.search).toEqual({ redirect: "/team" });
});

test("returns to the page the user asked for after signing in", async () => {
  mockApi(withSession(null, { "POST /api/v1/auth/login": { status: 200, body: ME_OWNER } }));
  const { router, user } = renderApp("/login?redirect=%2Fteam");
  await user.type(await screen.findByLabelText("Email"), "asha@alphatravels.in");
  await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
  await user.click(screen.getByRole("button", { name: "Engage" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/team"));
  expect(await screen.findByRole("banner")).toHaveTextContent("Alpha Travels");
});

test("ignores redirects to other sites", async () => {
  mockApi(withSession(null, { "POST /api/v1/auth/login": { status: 200, body: ME_OWNER } }));
  const { router, user } = renderApp("/login?redirect=%2F%2Fevil.example");
  await user.type(await screen.findByLabelText("Email"), "asha@alphatravels.in");
  await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
  await user.click(screen.getByRole("button", { name: "Engage" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
});

test.each([
  ["an absolute URL", "https%3A%2F%2Fevil.example"],
  ["a backslash", "%2F%5Cevil.example"],
  ["a tab", "%2F%09%2Fevil.example"],
  ["a newline", "%2F%0A%2Fevil.example"],
  ["double encoding", "%252F%252Fevil.example"],
])("ignores redirects smuggled with %s", async (_label, encoded) => {
  mockApi(withSession(null, { "POST /api/v1/auth/login": { status: 200, body: ME_OWNER } }));
  const { router, user } = renderApp(`/login?redirect=${encoded}`);
  await user.type(await screen.findByLabelText("Email"), "asha@alphatravels.in");
  await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
  await user.click(screen.getByRole("button", { name: "Engage" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(await screen.findByRole("heading", { name: "Mission Control" })).toBeInTheDocument();
});

test("keeps the query string of a same-site redirect", async () => {
  mockApi(withSession(null, { "POST /api/v1/auth/login": { status: 200, body: ME_OWNER } }));
  const { router, user } = renderApp(`/login?redirect=${encodeURIComponent("/team?tab=crew")}`);
  await user.type(await screen.findByLabelText("Email"), "asha@alphatravels.in");
  await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
  await user.click(screen.getByRole("button", { name: "Engage" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/team"));
  expect(router.state.location.search).toEqual({ tab: "crew" });
});

test("wrong credentials show the server's message and stay on login", async () => {
  mockApi(
    withSession(null, {
      "POST /api/v1/auth/login": { status: 401, body: { detail: "Invalid email or password." } },
    }),
  );
  const { router, user } = renderApp("/login");
  await user.type(await screen.findByLabelText("Email"), "asha@alphatravels.in");
  await user.type(screen.getByLabelText("Password"), "wrong-password-1");
  await user.click(screen.getByRole("button", { name: "Engage" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
  expect(router.state.location.pathname).toBe("/login");
});

test("signup shows field errors from the server", async () => {
  mockApi(
    withSession(null, {
      "POST /api/v1/auth/signup": {
        status: 422,
        body: {
          detail: "Some of the information you entered isn't valid.",
          errors: [{ field: "password", message: "String should have at least 10 characters" }],
        },
      },
    }),
  );
  const { user } = renderApp("/signup");
  await user.type(await screen.findByLabelText("Agency name"), "Alpha Travels");
  await user.type(screen.getByLabelText("Your name"), "Asha Rao");
  await user.type(screen.getByLabelText("Email"), "asha@alphatravels.in");
  await user.type(screen.getByLabelText("Password"), "short");
  await user.click(screen.getByRole("button", { name: "Create command deck" }));
  expect(await screen.findByLabelText("Password")).toHaveAccessibleDescription(
    "String should have at least 10 characters",
  );
});

test("signup conflicts show a plain message", async () => {
  mockApi(
    withSession(null, {
      "POST /api/v1/auth/signup": { status: 409, body: { detail: "An account with this email already exists." } },
    }),
  );
  const { user } = renderApp("/signup");
  await user.type(await screen.findByLabelText("Agency name"), "Alpha Travels");
  await user.type(screen.getByLabelText("Your name"), "Asha Rao");
  await user.type(screen.getByLabelText("Email"), "asha@alphatravels.in");
  await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
  await user.click(screen.getByRole("button", { name: "Create command deck" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("An account with this email already exists.");
});

test("a successful signup lands on Mission Control", async () => {
  const { calls } = mockApi(withSession(null, { "POST /api/v1/auth/signup": { status: 201, body: ME_OWNER } }));
  const { router, user } = renderApp("/signup");
  await user.type(await screen.findByLabelText("Agency name"), "Alpha Travels");
  await user.type(screen.getByLabelText("Your name"), "Asha Rao");
  await user.type(screen.getByLabelText("Email"), "asha@alphatravels.in");
  await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
  await user.click(screen.getByRole("button", { name: "Create command deck" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(calls.find((c) => c.path === "/api/v1/auth/signup")?.body).toEqual({
    agency_name: "Alpha Travels",
    full_name: "Asha Rao",
    email: "asha@alphatravels.in",
    password: "correct-horse-battery",
  });
});

test("signed-in users skip the login page", async () => {
  mockApi(withSession(ME_OWNER));
  const { router } = renderApp("/login");
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
});

test("accepting an invitation signs the new crew member in", async () => {
  const { calls } = mockApi(
    withSession(null, { "POST /api/v1/invitations/accept": { status: 201, body: ME_OWNER } }),
  );
  const { router, user } = renderApp("/invite/a-alpha.secret-token");
  await user.type(await screen.findByLabelText("Your name"), "Ravi Kumar");
  await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
  await user.click(screen.getByRole("button", { name: "Join the crew" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(calls.find((c) => c.path === "/api/v1/invitations/accept")?.body).toEqual({
    token: "a-alpha.secret-token",
    full_name: "Ravi Kumar",
    password: "correct-horse-battery",
  });
});

test("a dead invitation link explains itself", async () => {
  mockApi(
    withSession(null, {
      "POST /api/v1/invitations/accept": {
        status: 400,
        body: { detail: "This invitation link is invalid or has expired." },
      },
    }),
  );
  const { user } = renderApp("/invite/bad-token-value");
  await user.type(await screen.findByLabelText("Your name"), "Ravi Kumar");
  await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
  await user.click(screen.getByRole("button", { name: "Join the crew" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("This invitation link is invalid or has expired.");
});
