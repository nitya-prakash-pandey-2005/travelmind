import { screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { Me } from "../../api/types";
import { ME_AGENT, ME_DEMO, ME_OWNER } from "../../test/fixtures";
import { mockApi, type MockHandler } from "../../test/mockApi";
import { renderApp, withSession } from "../../test/renderApp";

vi.mock("../globe/webgl", () => ({ hasWebGL: () => false }));

const TEAM = [
  { id: "u-owner", email: "asha@alphatravels.in", full_name: "Asha Rao", role: "owner" },
  { id: "u-admin", email: "neha@alphatravels.in", full_name: "Neha Singh", role: "admin" },
  { id: "u-agent", email: "ravi@alphatravels.in", full_name: "Ravi Kumar", role: "agent" },
];

/** A brand colour that reads on both the dark and the light theme. */
const GOOD = "#0b84c6";

function profileOf(me: Me, extra: Record<string, unknown> = {}) {
  return { ...me.agency, brand_color: GOOD, demo_expires_at: null, ...extra };
}

function settings(me: Me = ME_OWNER, extra: Record<string, MockHandler> = {}, profile = profileOf(me)) {
  const api = mockApi(
    withSession(me, {
      "GET /api/v1/agency": { status: 200, body: profile },
      "GET /api/v1/team": { status: 200, body: TEAM },
      ...extra,
    }),
  );
  return { ...api, ...renderApp("/app/settings") };
}

async function profileForm() {
  return screen.findByRole("form", { name: "Agency profile" });
}

test("the profile form starts from the saved agency, with country and currency read-only", async () => {
  settings();
  expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
  const form = await profileForm();
  expect(within(form).getByLabelText("Agency name")).toHaveValue("Alpha Travels");
  const zone = within(form).getByLabelText("Time zone");
  expect(zone).toHaveValue("Asia/Kolkata");
  expect(within(zone).getByRole("option", { name: "(UTC+05:30) Asia/Kolkata" })).toBeInTheDocument();
  expect(within(form).getByLabelText("Country")).toHaveAttribute("readonly");
  expect(within(form).getByLabelText("Country")).toHaveValue("India (IN)");
  expect(within(form).getByLabelText("Currency")).toHaveAttribute("readonly");
  expect(within(form).getByLabelText("Currency")).toHaveValue("INR · Indian Rupee");
  expect(within(form).getByText(/set when the workspace was created/i)).toBeInTheDocument();
  expect(within(form).getByLabelText("Brand colour hex")).toHaveValue(GOOD);
  expect(within(form).getByLabelText("Brand colour picker")).toHaveValue(GOOD);
});

test("Save sends only what changed, then confirms and refreshes the session's agency", async () => {
  const { user, calls } = settings(ME_OWNER, {
    "PATCH /api/v1/agency": (call) => ({ status: 200, body: { ...profileOf(ME_OWNER), ...(call.body as object) } }),
  });
  const form = await profileForm();
  const save = within(form).getByRole("button", { name: "Save changes" });
  expect(save).toBeDisabled();

  await user.clear(within(form).getByLabelText("Agency name"));
  await user.type(within(form).getByLabelText("Agency name"), "Alpha Travel Co");
  await user.selectOptions(within(form).getByLabelText("Time zone"), "Asia/Dubai");
  await user.click(save);

  expect(await screen.findByText("Settings saved")).toBeInTheDocument();
  const patch = calls.find((c) => c.method === "PATCH");
  expect(patch?.path).toBe("/api/v1/agency");
  expect(patch?.body).toEqual({ name: "Alpha Travel Co", timezone: "Asia/Dubai" });
  await waitFor(() => expect(calls.filter((c) => c.path === "/api/v1/auth/me").length).toBeGreaterThan(1));
});

test("the brand colour follows both the picker and the hex field, and the preview shows it", async () => {
  const { user, calls } = settings(ME_OWNER, {
    "PATCH /api/v1/agency": (call) => ({ status: 200, body: { ...profileOf(ME_OWNER), ...(call.body as object) } }),
  });
  const form = await profileForm();
  const hex = within(form).getByLabelText("Brand colour hex");
  await user.clear(hex);
  await user.type(hex, "#7C3AED");
  expect(hex).toHaveValue("#7c3aed");
  expect(within(form).getByLabelText("Brand colour picker")).toHaveValue("#7c3aed");

  const preview = screen.getByRole("group", { name: "Client quote preview" });
  expect(within(preview).getAllByText("Alpha Travels").length).toBe(2);
  expect(within(preview).getAllByText("Accept option 1")).toHaveLength(2);
  expect(within(preview).queryByRole("button")).not.toBeInTheDocument();

  await user.click(within(form).getByRole("button", { name: "Save changes" }));
  expect(await screen.findByText("Settings saved")).toBeInTheDocument();
  expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ brand_color: "#7c3aed" });
});

test("a malformed hex is refused inline and blocks saving", async () => {
  const { user, calls } = settings();
  const form = await profileForm();
  const hex = within(form).getByLabelText("Brand colour hex");
  await user.clear(hex);
  await user.type(hex, "#12g45z");
  expect(within(form).getByText("Use # and six hex digits (0–9, a–f).")).toBeInTheDocument();
  expect(hex).toHaveAttribute("aria-invalid", "true");
  expect(within(form).getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(calls.some((c) => c.method === "PATCH")).toBe(false);
});

test("the contrast check rates the colour on both themes and blocks one below 3:1", async () => {
  const { user, calls } = settings();
  const form = await profileForm();
  const checks = within(form).getByRole("list", { name: "Contrast check" });
  expect(within(checks).getByText(/Dark theme/)).toBeInTheDocument();
  expect(within(checks).getAllByText("Passes")).toHaveLength(2);

  const hex = within(form).getByLabelText("Brand colour hex");
  await user.clear(hex);
  await user.type(hex, "#f5f5f5");
  expect(within(checks).getByText("Too faint")).toBeInTheDocument();
  expect(within(form).getByText(/needs at least 3:1 against both themes/)).toBeInTheDocument();
  expect(within(form).getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(calls.some((c) => c.method === "PATCH")).toBe(false);
});

test("a saved colour that fails a theme is flagged, but other changes can still be saved", async () => {
  const { user, calls } = settings(
    ME_OWNER,
    { "PATCH /api/v1/agency": (call) => ({ status: 200, body: { ...profileOf(ME_OWNER), ...(call.body as object) } }) },
    profileOf(ME_OWNER, { brand_color: "#22d3ee" }),
  );
  const form = await profileForm();
  expect(within(form).getByText(/your current colour/i)).toBeInTheDocument();
  await user.clear(within(form).getByLabelText("Agency name"));
  await user.type(within(form).getByLabelText("Agency name"), "Alpha Two");
  await user.click(within(form).getByRole("button", { name: "Save changes" }));
  expect(await screen.findByText("Settings saved")).toBeInTheDocument();
  expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ name: "Alpha Two" });
});

test("a server field error shows on its field", async () => {
  const { user } = settings(ME_OWNER, {
    "PATCH /api/v1/agency": {
      status: 422,
      body: { detail: "Check the highlighted fields.", errors: [{ field: "name", message: "Use at most 200 characters." }] },
    },
  });
  const form = await profileForm();
  await user.type(within(form).getByLabelText("Agency name"), " Ltd");
  await user.click(within(form).getByRole("button", { name: "Save changes" }));
  expect(await within(form).findByText("Use at most 200 characters.")).toBeInTheDocument();
  expect(within(form).getByLabelText("Agency name")).toHaveAttribute("aria-invalid", "true");
});

test("a short name is caught before sending", async () => {
  const { user, calls } = settings();
  const form = await profileForm();
  await user.clear(within(form).getByLabelText("Agency name"));
  await user.type(within(form).getByLabelText("Agency name"), "A");
  await user.click(within(form).getByRole("button", { name: "Save changes" }));
  expect(within(form).getByText("Use 2 to 200 characters.")).toBeInTheDocument();
  expect(calls.some((c) => c.method === "PATCH")).toBe(false);
});

test("a demo workspace shows the profile read-only with the demo note", async () => {
  settings(ME_DEMO, {}, profileOf(ME_DEMO, { demo_expires_at: "2026-10-04T10:00:00Z" }));
  const form = await profileForm();
  expect(within(form).getByLabelText("Agency name")).toBeDisabled();
  expect(within(form).getByLabelText("Time zone")).toBeDisabled();
  expect(within(form).getByLabelText("Brand colour hex")).toBeDisabled();
  expect(within(form).queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  expect(within(form).getByText(/Demo workspaces can't change settings/)).toBeInTheDocument();
  const workspace = screen.getByRole("region", { name: "Workspace" });
  expect(within(workspace).getByText("Demo workspace")).toBeInTheDocument();
});

test("an agent sees the profile read-only and who can change it", async () => {
  settings(ME_AGENT);
  const form = await profileForm();
  expect(within(form).getByLabelText("Agency name")).toBeDisabled();
  expect(within(form).getByText("Only owners and admins can change agency settings.")).toBeInTheDocument();
});

test("the side panels show the workspace, the team, appearance and data handling", async () => {
  settings();
  await profileForm();
  const workspace = screen.getByRole("region", { name: "Workspace" });
  expect(within(workspace).getByText("Agency workspace")).toBeInTheDocument();
  expect(within(workspace).getByText("Owner")).toBeInTheDocument();

  const team = screen.getByRole("region", { name: "Team" });
  expect(await within(team).findByText("3 people")).toBeInTheDocument();
  expect(within(team).getByText("1 owner · 1 admin · 1 agent")).toBeInTheDocument();
  expect(within(team).getByRole("link", { name: /Manage team/ })).toHaveAttribute("href", "/app/team");

  const appearance = screen.getByRole("region", { name: "Appearance" });
  expect(within(appearance).getByRole("listbox")).toBeInTheDocument();

  const privacy = screen.getByRole("region", { name: "Data and privacy" });
  expect(within(privacy).getAllByRole("listitem").length).toBeGreaterThanOrEqual(3);
});

test("a failed load says so and offers a retry", async () => {
  settings(ME_OWNER, { "GET /api/v1/agency": { status: 500, body: { detail: "Something went wrong on our side. Please try again." } } });
  expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong on our side.");
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
});
