import { screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { QuoteSummary } from "../../api/quotes";
import { ME_OWNER } from "../../test/fixtures";
import { mockApi, type MockCall, type MockHandler } from "../../test/mockApi";
import { renderApp, withSession } from "../../test/renderApp";
import { commandCenterMocks, enquiryOut } from "../../test/workspaceFixtures";
import { minutesAgo, quoteDetail, quoteSummary } from "./quoteFixtures";

vi.mock("../globe/webgl", () => ({ hasWebGL: () => false }));

const QUOTES: QuoteSummary[] = [
  quoteSummary({ id: "q-6", number: "Q-0006", status: "draft", current_version: 0, min_sell_minor: null, client: null }),
  quoteSummary({
    id: "q-5",
    number: "Q-0005",
    status: "viewed",
    current_version: 3,
    sent_version: 2,
    min_sell_minor: 4_520_000,
    sent_at: minutesAgo(90),
    client: { id: "c-rahul", name: "Rahul Mehta" },
    enquiry: { id: "e-3", number: "E-0003", origin: "BOM", destination: "GOI", depart_date: null },
  }),
  quoteSummary({ id: "q-4", number: "Q-0004", status: "sent", sent_version: 1, sent_at: minutesAgo(300) }),
  quoteSummary({ id: "q-3", number: "Q-0003", status: "accepted", sent_version: 1, min_sell_minor: 1_250_000, sent_at: minutesAgo(5000) }),
  quoteSummary({ id: "q-2", number: "Q-0002", status: "declined", sent_version: 1, sent_at: minutesAgo(9000) }),
];

function quotesPage(items: QuoteSummary[] = QUOTES, extra: Record<string, MockHandler> = {}) {
  const api = mockApi(
    withSession(ME_OWNER, {
      ...commandCenterMocks({ populated: true }),
      "GET /api/v1/quotes": (call: MockCall) => {
        const status = call.search.get("status");
        const rows = status ? items.filter((q) => q.status === status) : items;
        return { status: 200, body: { items: rows, total: rows.length } };
      },
      ...extra,
    }),
  );
  return { ...api, ...renderApp("/app/quotes") };
}

test("the list shows every quote with its client, route, status, value, versions and send date", async () => {
  quotesPage();
  expect(await screen.findByRole("heading", { level: 1, name: "Quotes" })).toBeInTheDocument();
  const table = await screen.findByRole("table", { name: "Quotes" });
  await within(table).findByText("Q-0005");
  for (const header of ["Number", "Client", "Route", "Status", "Value", "Versions", "Sent"]) {
    expect(within(table).getByRole("columnheader", { name: new RegExp(`^${header}`) })).toBeInTheDocument();
  }
  const row = within(table).getByText("Q-0005").closest("tr") as HTMLElement;
  expect(within(row).getByText("Rahul Mehta")).toBeInTheDocument();
  expect(within(row).getByText("BOM → GOI")).toBeInTheDocument();
  expect(within(row).getByText("Viewed")).toBeInTheDocument();
  expect(within(row).getByText("₹45,200")).toBeInTheDocument();
  expect(within(row).getByText("v3 · sent v2")).toBeInTheDocument();
  const draft = within(table).getByText("Q-0006").closest("tr") as HTMLElement;
  expect(within(draft).getByText("No client")).toBeInTheDocument();
  expect(within(draft).getByText("Not sent")).toBeInTheDocument();
  // Figures over the list.
  const figures = screen.getByRole("region", { name: "Quote figures" });
  expect(within(figures).getByRole("group", { name: /^Awaiting the client: 2/ })).toBeInTheDocument();
});

test("status tabs filter through the API and the search box narrows the rows", async () => {
  const { user, calls } = quotesPage();
  const table = await screen.findByRole("table", { name: "Quotes" });
  await within(table).findByText("Q-0005");
  await user.click(screen.getByRole("tab", { name: /^Sent/ }));
  await waitFor(() => expect(calls.some((c) => c.path === "/api/v1/quotes" && c.search.get("status") === "sent")).toBe(true));
  await waitFor(() => expect(within(table).queryByText("Q-0005")).not.toBeInTheDocument());
  expect(within(table).getByText("Q-0004")).toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: /^All/ }));
  await within(table).findByText("Q-0005");
  await user.type(screen.getByRole("searchbox", { name: "Search quotes" }), "rahul");
  await waitFor(() => expect(within(table).queryByText("Q-0004")).not.toBeInTheDocument());
  expect(within(table).getByText("Q-0005")).toBeInTheDocument();
});

test("a row opens its quote", async () => {
  const { user, router } = quotesPage();
  const table = await screen.findByRole("table", { name: "Quotes" });
  await user.click(await within(table).findByText("Q-0005"));
  await waitFor(() => expect(router.state.location.pathname).toBe("/app/quotes/q-5"));
});

test("with no quotes yet the page explains where quotes come from", async () => {
  quotesPage([]);
  expect(await screen.findByText("No quotes yet")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open pipeline" })).toHaveAttribute("href", "/app/pipeline");
});

test("New quote picks an open enquiry and a fixed markup, creates the quote and opens it", async () => {
  const created = quoteDetail({ id: "q-new", number: "Q-0009", markup_kind: "fixed", markup_value: 50_000 });
  const { user, calls, router } = quotesPage(QUOTES, {
    "GET /api/v1/enquiries": {
      status: 200,
      body: {
        items: [
          enquiryOut({ id: "e-7", number: "E-0007", origin: "DEL", destination: "GOI", status: "new", client: null }),
          enquiryOut({ id: "e-4", number: "E-0004", origin: "DEL", destination: "BOM", status: "won", client: null }),
        ],
        total: 2,
      },
    },
    "POST /api/v1/quotes": { status: 201, body: created },
    "GET /api/v1/quotes/q-new": { status: 200, body: created },
  });
  await user.click(await screen.findByRole("button", { name: "New quote" }));
  const dialog = screen.getByRole("dialog", { name: "New quote" });
  const choices = await within(dialog).findByRole("radiogroup", { name: "Open enquiries" });
  // Won and lost enquiries take no new quotes.
  expect(within(choices).queryByText("E-0004")).not.toBeInTheDocument();
  await user.click(within(choices).getByText("E-0007"));
  await user.click(within(dialog).getByRole("radio", { name: "Fixed amount" }));
  await user.type(within(dialog).getByLabelText("Markup per option (INR)"), "500");
  await user.click(within(dialog).getByRole("button", { name: "Create quote" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/app/quotes/q-new"));
  expect(calls.find((c) => c.method === "POST" && c.path === "/api/v1/quotes")?.body).toEqual({
    enquiry_id: "e-7",
    markup_kind: "fixed",
    markup_value: 50_000,
  });
});
