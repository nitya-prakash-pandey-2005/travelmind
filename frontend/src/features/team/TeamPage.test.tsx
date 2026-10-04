import { act, screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { AIRPORTS, ME_AGENT, ME_BETA, ME_DEMO, ME_OWNER } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { renderApp, withSession } from "../../test/renderApp";
import { routeStore } from "../route/routeStore";

const TEAM = [
  { id: "u-owner", email: "asha@alphatravels.in", full_name: "Asha Rao", role: "owner" },
  { id: "u-agent", email: "ravi@alphatravels.in", full_name: "Ravi Kumar", role: "agent" },
];
async function openInvite(user: UserEvent) {
  await user.click(await screen.findByRole("button", { name: "Invite teammate" }));
  await screen.findByRole("dialog", { name: "Invite teammate" });
}

const PENDING = {
  id: "i1",
  email: "neha@alphatravels.in",
  role: "admin",
  created_at: "2026-09-29T10:00:00Z",
  expires_at: "2026-10-06T10:00:00Z",
};

test("the members list shows everyone with their role, owners first, and sorts by name", async () => {
  const team = [...TEAM, { id: "u-admin", email: "zoya@alphatravels.in", full_name: "Zoya Khan", role: "admin" }].reverse();
  mockApi(withSession(ME_OWNER, { "GET /api/v1/team": { status: 200, body: team }, "GET /api/v1/invitations": { status: 200, body: [] } }));
  const { user } = renderApp("/app/team");
  const list = await screen.findByRole("list", { name: "Team members" });
  await within(list).findByText("Asha Rao");
  const names = () => within(list).getAllByRole("listitem").map((row) => row.textContent ?? "");
  const rows = within(list).getAllByRole("listitem");
  expect(rows).toHaveLength(3);
  expect(within(rows[0]!).getByText("Asha Rao")).toBeInTheDocument();
  expect(within(rows[0]!).getByText("You")).toBeInTheDocument();
  expect(within(rows[1]!).getByText("admin")).toBeInTheDocument();
  expect(within(rows[2]!).getByText("agent")).toBeInTheDocument();
  await user.click(within(screen.getByRole("group", { name: "Sort members" })).getByRole("button", { name: "Name" }));
  expect(within(screen.getByRole("group", { name: "Sort members" })).getByRole("button", { name: "Name" })).toHaveAttribute("aria-pressed", "true");
  expect(names().map((text) => text.match(/Asha Rao|Ravi Kumar|Zoya Khan/)?.[0])).toEqual(["Asha Rao", "Ravi Kumar", "Zoya Khan"]);
});

test("an owner invites a teammate and gets a one-time link", async () => {
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
  const { user } = renderApp("/app/team");
  // user-event installs a clipboard on navigator during setup; spy on it rather than replacing navigator.
  const writeText = vi.spyOn(navigator.clipboard, "writeText");

  await user.click(await screen.findByRole("button", { name: "Invite teammate" }));
  const dialog = await screen.findByRole("dialog", { name: "Invite teammate" });
  await user.type(within(dialog).getByLabelText("Email"), "neha@alphatravels.in");
  await user.selectOptions(within(dialog).getByLabelText("Role"), "admin");
  await user.click(within(dialog).getByRole("button", { name: "Create invite link" }));

  const link = await screen.findByLabelText("Invitation link");
  expect(link).toHaveValue(`${window.location.origin}/invite/a-alpha.tok3n`);
  expect(calls.find((c) => c.method === "POST")?.body).toEqual({ email: "neha@alphatravels.in", role: "admin" });
  expect(screen.getByText(/shown once/i)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Copy link" }));
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/invite/a-alpha.tok3n`);
  expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();

  const pending = await screen.findByRole("table", { name: "Pending invitations" });
  expect(await within(pending).findByText("neha@alphatravels.in")).toBeInTheDocument();
  expect(within(pending).getByText(/6 Oct 2026/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

test("inviting someone who already has an account explains why it failed", async () => {
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/team": { status: 200, body: TEAM },
      "GET /api/v1/invitations": { status: 200, body: [] },
      "POST /api/v1/invitations": { status: 409, body: { detail: "This person already has a TravelMind account." } },
    }),
  );
  const { user } = renderApp("/app/team");
  await openInvite(user);
  await user.type(screen.getByLabelText("Email"), "ravi@betatrips.in");
  await user.click(screen.getByRole("button", { name: "Create invite link" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("This person already has a TravelMind account.");
});

test("agents see the members but no invitation controls", async () => {
  const { calls } = mockApi(withSession(ME_AGENT, { "GET /api/v1/team": { status: 200, body: TEAM } }));
  renderApp("/app/team");
  await screen.findByRole("list", { name: "Team members" });
  expect(screen.queryByRole("button", { name: "Invite teammate" })).not.toBeInTheDocument();
  expect(screen.getByText(/ask an agency owner or admin/i)).toBeInTheDocument();
  expect(calls.some((c) => c.path === "/api/v1/invitations")).toBe(false);
});

test("a demo workspace shows the members but can't invite anyone", async () => {
  const { calls } = mockApi(withSession(ME_DEMO, { "GET /api/v1/team": { status: 200, body: TEAM } }));
  renderApp("/app/team");
  await screen.findByRole("list", { name: "Team members" });
  expect(screen.queryByRole("button", { name: "Invite teammate" })).not.toBeInTheDocument();
  expect(screen.getByText("Demo workspaces can't invite people. Create your own workspace to add teammates.")).toBeInTheDocument();
  expect(calls.some((c) => c.path === "/api/v1/invitations")).toBe(false);
});

test("redirects to login when the session expires", async () => {
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/team": { status: 401, body: { detail: "Your session has expired. Please sign in again." } },
      "GET /api/v1/invitations": { status: 200, body: [] },
    }),
  );
  const { router } = renderApp("/app/team");
  await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  expect(router.state.location.search).toEqual({ redirect: "/app/team" });
  expect(await screen.findByRole("heading", { name: "Sign in to TravelMind" })).toBeInTheDocument();
});

test("an expired session forgets the scanned route", async () => {
  onTestFinished(() => routeStore.reset());
  routeStore.set({ origin: AIRPORTS.DEL, destination: AIRPORTS.BOM });
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/team": { status: 401, body: { detail: "Your session has expired. Please sign in again." } },
      "GET /api/v1/invitations": { status: 200, body: [] },
    }),
  );
  const { router } = renderApp("/app/team");
  await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  expect(routeStore.get()).toEqual({ origin: null, destination: null });
});

test("after the session expires, the next agency to sign in never sees the previous team", async () => {
  let session: "alpha" | "expired" | "beta" = "alpha";
  let releaseBetaTeam!: () => void;
  const betaTeamReady = new Promise<void>((resolve) => {
    releaseBetaTeam = resolve;
  });
  const BETA_TEAM = [{ id: "u-beta", email: "meera@betatours.in", full_name: "Meera Iyer", role: "owner" }];
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/team": async () => {
        if (session === "alpha") return { status: 200, body: TEAM };
        if (session === "expired") {
          return { status: 401, body: { detail: "Your session has expired. Please sign in again." } };
        }
        await betaTeamReady;
        return { status: 200, body: BETA_TEAM };
      },
      "GET /api/v1/invitations": { status: 200, body: [] },
      "POST /api/v1/auth/login": () => {
        session = "beta";
        return { status: 200, body: ME_BETA };
      },
    }),
  );
  const { router, queryClient, user } = renderApp("/app/team");
  expect(await screen.findByText("Ravi Kumar")).toBeInTheDocument();

  session = "expired";
  await act(() => queryClient.invalidateQueries({ queryKey: ["team"] }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/login"));

  await user.type(await screen.findByLabelText("Email"), "meera@betatours.in");
  await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/app/team"));

  expect(await screen.findByText("Everyone with access to Beta Tours.")).toBeInTheDocument();
  expect(screen.queryByText("Ravi Kumar")).not.toBeInTheDocument();
  expect(screen.queryByText("ravi@alphatravels.in")).not.toBeInTheDocument();
  expect(screen.getByText("Loading members…")).toBeInTheDocument();

  releaseBetaTeam();
  const table = await screen.findByRole("list", { name: "Team members" });
  expect(await within(table).findByText("Meera Iyer")).toBeInTheDocument();
  expect(within(table).queryByText("Ravi Kumar")).not.toBeInTheDocument();
});

test("a failed members load shows the server's message and trace ID instead of a table", async () => {
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/team": {
        status: 500,
        body: { detail: "Something went wrong on our side. Please try again.", trace_id: "trace-team-1" },
      },
      "GET /api/v1/invitations": { status: 200, body: [] },
    }),
  );
  renderApp("/app/team");
  const members = await screen.findByRole("region", { name: "Members" });
  const alert = await within(members).findByRole("alert");
  expect(alert).toHaveTextContent("Something went wrong on our side. Please try again.");
  expect(alert).toHaveTextContent("Trace ID: trace-team-1");
  expect(screen.queryByRole("list", { name: "Team members" })).not.toBeInTheDocument();
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
  renderApp("/app/team");
  const pending = await screen.findByRole("region", { name: "Pending invitations" });
  const alert = await within(pending).findByRole("alert");
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
  const { user } = renderApp("/app/team");
  await openInvite(user);
  await user.type(screen.getByLabelText("Email"), "not-an-email");
  await user.click(screen.getByRole("button", { name: "Create invite link" }));
  await waitFor(() => expect(screen.getByLabelText("Email")).toHaveAccessibleDescription("value is not a valid email address"));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("a role error, which has no inline slot, is shown as a general message", async () => {
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/team": { status: 200, body: TEAM },
      "GET /api/v1/invitations": { status: 200, body: [] },
      "POST /api/v1/invitations": {
        status: 422,
        body: {
          detail: "Some of the information you entered isn't valid.",
          errors: [{ field: "role", message: "Input should be 'admin' or 'agent'" }],
        },
      },
    }),
  );
  const { user } = renderApp("/app/team");
  await openInvite(user);
  await user.type(screen.getByLabelText("Email"), "neha@alphatravels.in");
  await user.click(screen.getByRole("button", { name: "Create invite link" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Some of the information you entered isn't valid.");
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
  const { user } = renderApp("/app/team");
  await openInvite(user);
  await user.type(screen.getByLabelText("Email"), "neha@alphatravels.in");
  await user.click(screen.getByRole("button", { name: "Create invite link" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Something went wrong on our side. Please try again.");
  expect(alert).toHaveTextContent("Trace ID: trace-post-1");
});

const STATS = {
  members: [
    { user: { id: "u-agent", full_name: "Ravi Kumar", role: "agent" }, enquiries: 6, quotes_sent: 5, won_value_minor: 4200000 },
    { user: { id: "u-owner", full_name: "Asha Rao", role: "owner" }, enquiries: 9, quotes_sent: 0, won_value_minor: 0 },
  ],
};

test("each member shows enquiries, quotes sent and won value for the last 30 days", async () => {
  const { calls } = mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/team": { status: 200, body: TEAM },
      "GET /api/v1/invitations": { status: 200, body: [] },
      "GET /api/v1/dashboard/team": { status: 200, body: STATS },
    }),
  );
  renderApp("/app/team");
  const list = await screen.findByRole("list", { name: "Team members" });
  const member = (name: string) => within(list).getByText(name).closest("li") as HTMLElement;
  await within(list).findByText("Ravi Kumar");
  const ravi = member("Ravi Kumar");
  await within(ravi).findByText("₹42,000");
  expect(within(ravi).getByText("6")).toBeInTheDocument();
  expect(within(ravi).getByText("5")).toBeInTheDocument();
  const asha = member("Asha Rao");
  expect(within(asha).getByText("9")).toBeInTheDocument();
  expect(within(asha).getAllByText("—")).toHaveLength(1);
  expect(calls.find((c) => c.path === "/api/v1/dashboard/team")?.search.get("range")).toBe("30d");

  const totals = screen.getByRole("region", { name: "Team totals" });
  expect(within(totals).getByRole("group", { name: "Enquiries: 15" })).toBeInTheDocument();
  expect(within(totals).getByRole("group", { name: "Won value: ₹42K" })).toBeInTheDocument();
  expect(within(totals).getByRole("group", { name: "Members: 2" })).toHaveTextContent("1 owner or admin");
});

test("when performance figures fail, the members table still loads and says so", async () => {
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/team": { status: 200, body: TEAM },
      "GET /api/v1/invitations": { status: 200, body: [] },
      "GET /api/v1/dashboard/team": { status: 500, body: { detail: "Something went wrong on our side." } },
    }),
  );
  renderApp("/app/team");
  const members = await screen.findByRole("region", { name: "Members" });
  expect(await within(members).findByText("Performance figures are unavailable right now.")).toBeInTheDocument();
  expect(within(members).queryByRole("alert")).not.toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Team totals" })).getByRole("group", { name: "Won value: —" })).toBeInTheDocument();
});

test("roles and permissions reflect what the API allows, with the viewer's role marked", async () => {
  mockApi(withSession(ME_AGENT, { "GET /api/v1/team": { status: 200, body: TEAM } }));
  renderApp("/app/team");
  const panel = await screen.findByRole("region", { name: "Roles and permissions" });
  const roles = within(panel).getByRole("list", { name: "Roles" });
  expect(within(roles).getAllByRole("listitem")[2]).toHaveTextContent("AgentYou");
  const matrix = within(panel).getByRole("table", { name: "Permissions by role" });
  const cells = (name: string) =>
    within(within(matrix).getByRole("row", { name: new RegExp(name) }))
      .getAllByRole("cell")
      .map((c) => c.textContent);
  expect(cells("Invite teammates")).toEqual(["Allowed", "Allowed", "Not allowed"]);
  expect(cells("Change agency details")).toEqual(["Allowed", "Allowed", "Not allowed"]);
  expect(cells("Work enquiries, quotes and clients")).toEqual(["Allowed", "Allowed", "Allowed"]);
});
