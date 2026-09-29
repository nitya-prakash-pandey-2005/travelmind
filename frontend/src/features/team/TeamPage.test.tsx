import { screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ME_AGENT, ME_OWNER } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { renderApp, withSession } from "../../test/renderApp";

const TEAM = [
  { id: "u-owner", email: "asha@alphatravels.in", full_name: "Asha Rao", role: "owner" },
  { id: "u-agent", email: "ravi@alphatravels.in", full_name: "Ravi Kumar", role: "agent" },
];
const PENDING = {
  id: "i1",
  email: "neha@alphatravels.in",
  role: "admin",
  created_at: "2026-09-29T10:00:00Z",
  expires_at: "2026-10-06T10:00:00Z",
};

test("the roster lists every crew member with their role", async () => {
  mockApi(withSession(ME_OWNER, { "GET /api/v1/team": { status: 200, body: TEAM }, "GET /api/v1/invitations": { status: 200, body: [] } }));
  renderApp("/team");
  const table = await screen.findByRole("table", { name: "Crew members" });
  const rows = within(table).getAllByRole("row");
  expect(rows).toHaveLength(3);
  expect(within(rows[1]!).getByText("Asha Rao")).toBeInTheDocument();
  expect(within(rows[1]!).getByText("You")).toBeInTheDocument();
  expect(within(rows[2]!).getByText("agent")).toBeInTheDocument();
});

test("an owner invites a crew member and gets a one-time link", async () => {
  let invitationsCalls = 0;
  const { calls } = mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/team": { status: 200, body: TEAM },
      "GET /api/v1/invitations": () => {
        invitationsCalls += 1;
        return { status: 200, body: invitationsCalls === 1 ? [] : [PENDING] };
      },
      "POST /api/v1/invitations": { status: 201, body: { ...PENDING, token: "a-alpha.tok3n" } },
    }),
  );
  const { user } = renderApp("/team");
  // user-event installs a clipboard on navigator during setup; spy on it rather than replacing navigator.
  const writeText = vi.spyOn(navigator.clipboard, "writeText");

  await user.type(await screen.findByLabelText("Crew member email"), "neha@alphatravels.in");
  await user.selectOptions(screen.getByLabelText("Role"), "admin");
  await user.click(screen.getByRole("button", { name: "Generate invitation" }));

  const link = await screen.findByLabelText("Invitation link");
  expect(link).toHaveValue(`${window.location.origin}/invite/a-alpha.tok3n`);
  expect(calls.find((c) => c.method === "POST")?.body).toEqual({ email: "neha@alphatravels.in", role: "admin" });
  expect(screen.getByText(/shown once/i)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Copy link" }));
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/invite/a-alpha.tok3n`);
  expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();

  const pending = await screen.findByRole("list", { name: "Pending invitations" });
  expect(await within(pending).findByText("neha@alphatravels.in")).toBeInTheDocument();
  expect(within(pending).getByText(/6 Oct 2026/)).toBeInTheDocument();
});

test("inviting someone who already has an account explains why it failed", async () => {
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/team": { status: 200, body: TEAM },
      "GET /api/v1/invitations": { status: 200, body: [] },
      "POST /api/v1/invitations": { status: 409, body: { detail: "This person already has a TravelMind account." } },
    }),
  );
  const { user } = renderApp("/team");
  await user.type(await screen.findByLabelText("Crew member email"), "ravi@betatrips.in");
  await user.click(screen.getByRole("button", { name: "Generate invitation" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("This person already has a TravelMind account.");
});

test("agents see the roster but no invitation controls", async () => {
  const { calls } = mockApi(withSession(ME_AGENT, { "GET /api/v1/team": { status: 200, body: TEAM } }));
  renderApp("/team");
  await screen.findByRole("table", { name: "Crew members" });
  expect(screen.queryByLabelText("Crew member email")).not.toBeInTheDocument();
  expect(screen.getByText(/ask an agency owner or admin/i)).toBeInTheDocument();
  expect(calls.some((c) => c.path === "/api/v1/invitations")).toBe(false);
});

test("redirects to login when the session expires", async () => {
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/team": { status: 401, body: { detail: "Your session has expired. Please sign in again." } },
      "GET /api/v1/invitations": { status: 200, body: [] },
    }),
  );
  const { router } = renderApp("/team");
  await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  expect(router.state.location.search).toEqual({ redirect: "/team" });
  expect(await screen.findByRole("heading", { name: "Mission access" })).toBeInTheDocument();
});

test("a failed roster load shows the server's message and trace ID instead of a table", async () => {
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/team": {
        status: 500,
        body: { detail: "Something went wrong on our side. Please try again.", trace_id: "trace-team-1" },
      },
      "GET /api/v1/invitations": { status: 200, body: [] },
    }),
  );
  renderApp("/team");
  const roster = await screen.findByRole("region", { name: "Alpha Travels crew" });
  const alert = await within(roster).findByRole("alert");
  expect(alert).toHaveTextContent("Something went wrong on our side. Please try again.");
  expect(alert).toHaveTextContent("Trace ID: trace-team-1");
  expect(screen.queryByRole("table", { name: "Crew members" })).not.toBeInTheDocument();
});

test("a failed invitations load shows the server's message and never claims nothing is pending", async () => {
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/team": { status: 200, body: TEAM },
      "GET /api/v1/invitations": {
        status: 500,
        body: { detail: "Something went wrong on our side. Please try again.", trace_id: "trace-inv-1" },
      },
    }),
  );
  renderApp("/team");
  const invitePanel = await screen.findByRole("region", { name: "Invite crew" });
  const alert = await within(invitePanel).findByRole("alert");
  expect(alert).toHaveTextContent("Something went wrong on our side. Please try again.");
  expect(alert).toHaveTextContent("Trace ID: trace-inv-1");
  expect(screen.queryByText("No pending invitations.")).not.toBeInTheDocument();
});

test("an invalid invitation email is reported on the email field", async () => {
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/team": { status: 200, body: TEAM },
      "GET /api/v1/invitations": { status: 200, body: [] },
      "POST /api/v1/invitations": {
        status: 422,
        body: {
          detail: "Some of the information you entered isn't valid.",
          errors: [{ field: "email", message: "value is not a valid email address" }],
        },
      },
    }),
  );
  const { user } = renderApp("/team");
  await user.type(await screen.findByLabelText("Crew member email"), "not-an-email");
  await user.click(screen.getByRole("button", { name: "Generate invitation" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Crew member email")).toHaveAccessibleDescription("value is not a valid email address"),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("a server failure while inviting shows the message and trace ID", async () => {
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/team": { status: 200, body: TEAM },
      "GET /api/v1/invitations": { status: 200, body: [] },
      "POST /api/v1/invitations": {
        status: 500,
        body: { detail: "Something went wrong on our side. Please try again.", trace_id: "trace-post-1" },
      },
    }),
  );
  const { user } = renderApp("/team");
  await user.type(await screen.findByLabelText("Crew member email"), "neha@alphatravels.in");
  await user.click(screen.getByRole("button", { name: "Generate invitation" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Something went wrong on our side. Please try again.");
  expect(alert).toHaveTextContent("Trace ID: trace-post-1");
});
