import { screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ME_OWNER } from "../../test/fixtures";
import { mockApi, type MockHandler } from "../../test/mockApi";
import { renderApp, withSession } from "../../test/renderApp";
import { commandCenterMocks, enquiryOut } from "../../test/workspaceFixtures";

vi.mock("../globe/webgl", () => ({ hasWebGL: () => false }));

const TEAM = [
  { id: "u-owner", email: "asha@alphatravels.in", full_name: "Asha Rao", role: "owner" },
  { id: "u-agent", email: "ravi@alphatravels.in", full_name: "Ravi Kumar", role: "agent" },
];

const ENQUIRY = {
  ...enquiryOut({
    id: "e-5",
    number: "E-0005",
    origin: "DEL",
    destination: "BOM",
    status: "quoted",
    client: { id: "c-priya", name: "Priya Sharma" },
  }),
  depart_date: "2026-11-20",
  return_date: "2026-11-27",
  cabin: "business",
  notes: "Prefers aisle seats",
};

const QUOTE = {
  id: "q-5",
  number: "Q-0005",
  status: "viewed",
  currency: "INR",
  client: { id: "c-priya", name: "Priya Sharma", kind: "individual" },
  enquiry: { id: "e-5", number: "E-0005", origin: "DEL", destination: "BOM", depart_date: "2026-11-20" },
  current_version: 3,
  sent_version: 3,
  min_sell_minor: 4_520_000,
  value_minor: 4_520_000,
  sent_at: "2026-10-01T09:00:00Z",
  decided_at: null,
  created_at: "2026-09-30T09:00:00Z",
};

const TIMELINE = {
  items: [
    {
      id: "a1",
      kind: "quote.viewed",
      summary: "Client opened Q-0005",
      occurred_at: new Date(Date.now() - 30 * 60_000).toISOString(),
      actor: null,
    },
    {
      id: "a2",
      kind: "enquiry.created",
      summary: "New enquiry E-0005 · DEL → BOM",
      occurred_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      actor: { id: "u-owner", full_name: "Asha Rao" },
    },
  ],
};

function enquiryPage(extra: Record<string, MockHandler> = {}) {
  const api = mockApi(
    withSession(ME_OWNER, {
      ...commandCenterMocks({ populated: true }),
      "GET /api/v1/team": { status: 200, body: TEAM },
      "GET /api/v1/enquiries/e-5": { status: 200, body: ENQUIRY },
      "GET /api/v1/enquiries/e-5/activity": { status: 200, body: TIMELINE },
      "GET /api/v1/quotes": { status: 200, body: { items: [QUOTE], total: 1 } },
      ...extra,
    }),
  );
  return { ...api, ...renderApp("/app/enquiries/e-5") };
}

test("the header, trip, quotes and timeline describe the enquiry", async () => {
  const { calls } = enquiryPage();
  // The first test of the file also pays for the app's first render; give it room under full-suite load.
  expect(await screen.findByRole("heading", { level: 1, name: "E-0005" }, { timeout: 5000 })).toBeInTheDocument();
  const main = screen.getByRole("main");
  expect(within(main).getAllByText("Quoted").length).toBeGreaterThan(0);
  expect(within(main).getAllByRole("link", { name: "Priya Sharma" })[0]).toHaveAttribute("href", "/app/clients/c-priya");
  expect(within(main).getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent("Pipeline");

  const trip = screen.getByRole("region", { name: "Trip" });
  expect(trip).toHaveTextContent("Business");
  expect(trip).toHaveTextContent("Prefers aisle seats");
  expect(trip).toHaveTextContent("20 Nov 2026");

  const quotes = await screen.findByRole("table", { name: "Quotes for E-0005" });
  expect(within(quotes).getByText("Q-0005")).toBeInTheDocument();
  expect(within(quotes).getByText("₹45,200")).toBeInTheDocument();
  expect(calls.some((c) => c.path === "/api/v1/quotes" && c.search.get("enquiry_id") === "e-5")).toBe(true);

  const timeline = screen.getByRole("region", { name: "Timeline" });
  expect(await within(timeline).findByText("Client opened Q-0005")).toBeInTheDocument();
  expect(within(timeline).getByText("New enquiry E-0005 · DEL → BOM")).toBeInTheDocument();
});

test("Scan fares opens Fare search with the whole trip filled in: return date and children too", async () => {
  const { user, router } = enquiryPage({
    "GET /api/v1/enquiries/e-5": { status: 200, body: { ...ENQUIRY, children_ages: [4, 11] } },
  });
  const link = await screen.findByRole("link", { name: "Scan fares" });
  const href = new URL(link.getAttribute("href") ?? "", "http://localhost");
  expect(href.pathname).toBe("/app/fares");
  expect(Object.fromEntries(href.searchParams)).toEqual({
    origin: "DEL",
    destination: "BOM",
    depart: "2026-11-20",
    return: "2026-11-27",
    adults: "2",
    children: "[4,11]",
    cabin: "business",
  });
  await user.click(link);
  await waitFor(() => expect(router.state.location.pathname).toBe("/app/fares"));
  expect(router.state.location.search).toMatchObject({ return: "2026-11-27", children: [4, 11] });
});

test("a one-way trip for adults only leaves the return date and children out of the link", async () => {
  enquiryPage({ "GET /api/v1/enquiries/e-5": { status: 200, body: { ...ENQUIRY, return_date: null } } });
  const link = await screen.findByRole("link", { name: "Scan fares" });
  const params = new URL(link.getAttribute("href") ?? "", "http://localhost").searchParams;
  expect(params.has("return")).toBe(false);
  expect(params.has("children")).toBe(false);
});

test("quote values (the server's value, not the cheapest current option) and the budget show in whole units", async () => {
  enquiryPage({
    "GET /api/v1/enquiries/e-5": { status: 200, body: { ...ENQUIRY, budget: { amount_minor: 6_000_049, currency: "INR" } } },
    "GET /api/v1/quotes": { status: 200, body: { items: [{ ...QUOTE, min_sell_minor: 2_100_000, value_minor: 2_577_225 }], total: 1 } },
  });
  const quotes = await screen.findByRole("table", { name: "Quotes for E-0005" });
  expect(await within(quotes).findByText("₹25,772")).toBeInTheDocument();
  expect(screen.queryByText(/₹25,772\.25/)).not.toBeInTheDocument();
  const trip = screen.getByRole("region", { name: "Trip" });
  expect(within(trip).getByText("₹60,000")).toBeInTheDocument();
  expect(trip).not.toHaveTextContent("₹60,000.49");
  // Headline tiles are compact, like every other KPI tile.
  expect(within(screen.getByRole("region", { name: "Enquiry figures" })).getByRole("group", { name: /^Quote value: ₹25\.8K/ })).toBeInTheDocument();
  expect(within(quotes).queryByText("₹21,000")).not.toBeInTheDocument();
});

test("Create quote opens the new-quote dialog for this enquiry, then starts the quote and opens it", async () => {
  const { calls, user, router } = enquiryPage({
    "POST /api/v1/quotes": {
      status: 201,
      body: {
        ...QUOTE,
        id: "q-new",
        number: "Q-0009",
        status: "draft",
        current_version: 0,
        sent_version: null,
        min_sell_minor: null,
        markup_kind: "percent",
        markup_value: 0,
        share_expires_at: null,
        first_viewed_at: null,
        decided_at: null,
        accepted_option: null,
        versions: [],
      },
    },
    "GET /api/v1/quotes/q-new": { status: 404, body: { detail: "Quote not found." } },
  });
  await user.click(await screen.findByRole("button", { name: "Create quote" }));
  const dialog = screen.getByRole("dialog", { name: "New quote" });
  // Prefilled with this enquiry: no picker, nothing posted yet.
  expect(within(dialog).getByText("E-0005 DEL → BOM")).toBeInTheDocument();
  expect(within(dialog).queryByRole("radiogroup", { name: "Open enquiries" })).not.toBeInTheDocument();
  expect(calls.some((c) => c.method === "POST" && c.path === "/api/v1/quotes")).toBe(false);
  await user.type(within(dialog).getByLabelText("Markup (%)"), "7.5");
  await user.click(within(dialog).getByRole("button", { name: "Create quote" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/app/quotes/q-new"));
  expect(calls.find((c) => c.method === "POST" && c.path === "/api/v1/quotes")?.body).toEqual({
    enquiry_id: "e-5",
    markup_kind: "percent",
    markup_value: 750,
  });
});

test("a lost enquiry can't be quoted until it is reopened", async () => {
  const { user } = enquiryPage({
    "GET /api/v1/enquiries/e-5": { status: 200, body: { ...ENQUIRY, status: "lost", lost_reason: "Went with another agency", closed_at: "2026-10-02T09:00:00Z" } },
  });
  const create = await screen.findByRole("button", { name: "Create quote" });
  expect(create).toBeDisabled();
  expect(create).toHaveAccessibleDescription("Reopen the enquiry to quote again.");
  const quotes = screen.getByRole("region", { name: "Quotes" });
  const another = await within(quotes).findByRole("button", { name: "New quote" });
  expect(another).toBeDisabled();
  expect(another).toHaveAccessibleDescription("Reopen the enquiry to quote again.");
  await user.click(create);
  expect(screen.queryByRole("dialog", { name: "New quote" })).not.toBeInTheDocument();
});

test("a won enquiry can't be quoted again, even from its empty quotes list", async () => {
  enquiryPage({
    "GET /api/v1/enquiries/e-5": { status: 200, body: { ...ENQUIRY, status: "won", closed_at: "2026-10-02T09:00:00Z" } },
    "GET /api/v1/quotes": { status: 200, body: { items: [], total: 0 } },
  });
  const header = await screen.findByRole("button", { name: "Create quote" });
  expect(header).toBeDisabled();
  expect(header).toHaveAccessibleDescription("This enquiry is won. Add a new enquiry to quote another trip.");
  const quotes = screen.getByRole("region", { name: "Quotes" });
  const empty = await within(quotes).findByRole("button", { name: "Create quote" });
  expect(empty).toBeDisabled();
  expect(empty).toHaveAccessibleDescription("This enquiry is won. Add a new enquiry to quote another trip.");
});

test("Edit saves only the changed fields", async () => {
  const { calls, user } = enquiryPage({
    "PATCH /api/v1/enquiries/e-5": (call) => ({ status: 200, body: { ...ENQUIRY, ...(call.body as object) } }),
  });
  await user.click(await screen.findByRole("button", { name: "Edit" }));
  const drawer = await screen.findByRole("dialog", { name: "Edit E-0005" });
  const adults = within(drawer).getByLabelText("Adults");
  await user.clear(adults);
  await user.type(adults, "3");
  await user.selectOptions(within(drawer).getByLabelText("Assignee"), "u-agent");
  await user.click(within(drawer).getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
  expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ adults: 3, assignee_user_id: "u-agent" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

test("the status menu offers only allowed moves", async () => {
  const { user } = enquiryPage();
  await user.click(await screen.findByRole("button", { name: "Move E-0005" }));
  const menu = await screen.findByRole("menu");
  expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    "Move to Won",
    "Move to Lost",
    "Move to Quoting",
  ]);
});

test("an enquiry with no activity says so", async () => {
  enquiryPage({ "GET /api/v1/enquiries/e-5/activity": { status: 200, body: { items: [] } } });
  const timeline = await screen.findByRole("region", { name: "Timeline" });
  expect(await within(timeline).findByText("No activity yet")).toBeInTheDocument();
});

test("a timeline that fails to load offers a retry", async () => {
  enquiryPage({
    "GET /api/v1/enquiries/e-5/activity": { status: 500, body: { detail: "Something went wrong on our side. Please try again." } },
  });
  const timeline = await screen.findByRole("region", { name: "Timeline" });
  expect(await within(timeline).findByRole("alert")).toHaveTextContent("Something went wrong on our side");
  expect(within(timeline).getByRole("button", { name: "Retry" })).toBeInTheDocument();
});

test("an unknown enquiry says it can't be found", async () => {
  mockApi(
    withSession(ME_OWNER, {
      ...commandCenterMocks(),
      "GET /api/v1/enquiries/nope": { status: 404, body: { detail: "Enquiry not found." } },
    }),
  );
  renderApp("/app/enquiries/nope");
  expect(await screen.findByText("Enquiry not found")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Back to pipeline" })).toHaveAttribute("href", "/app/pipeline");
});

test("the Pipeline item stays highlighted on an enquiry page", async () => {
  enquiryPage();
  await screen.findByRole("heading", { level: 1, name: "E-0005" });
  const nav = screen.getByRole("navigation", { name: "Primary" });
  expect(within(nav).getByRole("link", { name: "Pipeline" })).toHaveAttribute("aria-current", "page");
  expect(within(nav).getByRole("link", { name: "Command Center" })).not.toHaveAttribute("aria-current");
});
