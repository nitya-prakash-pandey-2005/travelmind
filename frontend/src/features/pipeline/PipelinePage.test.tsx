import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ME_OWNER } from "../../test/fixtures";
import { mockApi, type MockCall, type MockHandler } from "../../test/mockApi";
import { renderApp, withSession } from "../../test/renderApp";
import { commandCenterMocks, enquiryOut } from "../../test/workspaceFixtures";

vi.mock("../globe/webgl", () => ({ hasWebGL: () => false }));

const TEAM = [
  { id: "u-owner", email: "asha@alphatravels.in", full_name: "Asha Rao", role: "owner" },
  { id: "u-agent", email: "ravi@alphatravels.in", full_name: "Ravi Kumar", role: "agent" },
];

function quote(id: string, enquiryId: string, number: string, status: string, minSell: number, createdMinutesAgo: number) {
  return {
    id,
    number,
    status,
    currency: "INR",
    client: { id: "c-priya", name: "Priya Sharma" },
    enquiry: { id: enquiryId, number: "E-0000", origin: "DEL", destination: "BOM", depart_date: "2026-11-20" },
    current_version: 2,
    sent_version: status === "draft" ? null : 2,
    min_sell_minor: minSell,
    sent_at: null,
    created_at: new Date(Date.now() - createdMinutesAgo * 60_000).toISOString(),
  };
}

const QUOTES = [
  quote("q-5", "e-5", "Q-0005", "sent", 4_520_000, 60),
  quote("q-5-old", "e-5", "Q-0003", "declined", 3_900_000, 600),
  quote("q-4", "e-4", "Q-0004", "accepted", 6_200_000, 900),
];

function board(extra: Record<string, MockHandler> = {}) {
  const api = mockApi(
    withSession(ME_OWNER, {
      ...commandCenterMocks({ populated: true }),
      "GET /api/v1/team": { status: 200, body: TEAM },
      "GET /api/v1/quotes": { status: 200, body: { items: QUOTES, total: QUOTES.length } },
      ...extra,
    }),
  );
  return { ...api, ...renderApp("/app/pipeline") };
}

const column = (name: string) => screen.findByRole("list", { name: `${name} enquiries` });
const statusPosts = (calls: MockCall[]) => calls.filter((c) => c.method === "POST" && c.path.endsWith("/status"));

test("the board shows each stage with its count, value and cards", async () => {
  board();
  expect(await screen.findByRole("heading", { level: 1, name: "Pipeline" })).toBeInTheDocument();
  const fresh = await column("New");
  await waitFor(() => expect(within(fresh).getAllByRole("article")).toHaveLength(2));
  for (const name of ["Quoting", "Quoted", "Won", "Lost"]) expect(await column(name)).toBeInTheDocument();

  const quoted = await column("Quoted");
  const card = within(quoted).getByRole("article", { name: "E-0005 DEL → BOM" });
  // The latest quote's value, not the older declined one.
  await within(card).findByText("₹45,200");
  expect(within(card).queryByText("₹39,000")).not.toBeInTheDocument();
  expect(card).toHaveTextContent("Priya Sharma");
  expect(card).toHaveTextContent("2 adults");
  expect(card).toHaveTextContent("3 d");
  expect(within(card).getByRole("img", { name: "Asha Rao" })).toBeInTheDocument();

  const stage = screen.getByRole("region", { name: "Quoted" });
  expect(within(stage).getByTestId("stage-count")).toHaveTextContent("1");
  expect(within(stage).getByTestId("stage-value")).toHaveTextContent("₹45,200");
  expect(within(await column("Lost")).queryAllByRole("article")).toHaveLength(0);
  expect(screen.getByRole("region", { name: "Lost" })).toHaveTextContent(/Nothing lost/);
});

test("a card moves to Quoting from its Move menu by keyboard", async () => {
  // The server's list follows the move, as it would after the refetch.
  const items = commandCenterMocks({ populated: true });
  let moved = false;
  const list = items["GET /api/v1/enquiries"];
  const { calls, user } = board({
    "GET /api/v1/enquiries": async (call) => {
      const result = typeof list === "function" ? await list(call) : list!;
      const body = result.body as { items: { id: string; status: string }[] };
      return moved ? { ...result, body: { ...body, items: body.items.map((e) => (e.id === "e-6" ? { ...e, status: "quoting" } : e)) } } : result;
    },
    "POST /api/v1/enquiries/e-6/status": () => {
      moved = true;
      return {
        status: 200,
        body: enquiryOut({ id: "e-6", number: "E-0006", origin: "BOM", destination: "GOI", status: "quoting", client: null }),
      };
    },
  });
  const card = await within(await column("New")).findByRole("article", { name: "E-0006 BOM → GOI" });
  const trigger = within(card).getByRole("button", { name: "Move E-0006" });
  trigger.focus();
  await user.keyboard("{Enter}");
  const menu = await screen.findByRole("menu");
  expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    "Move to Quoting",
    "Move to Quoted",
    "Move to Lost",
  ]);
  expect(within(menu).getByRole("menuitem", { name: "Move to Quoting" })).toHaveFocus();
  await user.keyboard("{Enter}");

  await waitFor(() => expect(statusPosts(calls)).toHaveLength(1));
  expect(statusPosts(calls)[0]?.body).toEqual({ status: "quoting" });
  expect(await within(await column("Quoting")).findByRole("article", { name: "E-0006 BOM → GOI" })).toBeInTheDocument();
});

test("moving to Lost asks for a reason first", async () => {
  const { calls, user } = board({
    "POST /api/v1/enquiries/e-6/status": {
      status: 200,
      body: enquiryOut({ id: "e-6", number: "E-0006", origin: "BOM", destination: "GOI", status: "lost", client: null }),
    },
  });
  const card = await within(await column("New")).findByRole("article", { name: "E-0006 BOM → GOI" });
  await user.click(within(card).getByRole("button", { name: "Move E-0006" }));
  await user.click(await screen.findByRole("menuitem", { name: "Move to Lost" }));

  const dialog = await screen.findByRole("dialog", { name: "Mark E-0006 as lost" });
  await user.click(within(dialog).getByRole("button", { name: "Mark as lost" }));
  expect(within(dialog).getByText(/Enter why this enquiry was lost/)).toBeInTheDocument();
  expect(statusPosts(calls)).toHaveLength(0);

  await user.type(within(dialog).getByLabelText("Reason"), "Booked directly with the airline");
  await user.click(within(dialog).getByRole("button", { name: "Mark as lost" }));
  await waitFor(() => expect(statusPosts(calls)).toHaveLength(1));
  expect(statusPosts(calls)[0]?.body).toEqual({ status: "lost", lost_reason: "Booked directly with the airline" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

test("a refused move shows the server's message and puts the card back", async () => {
  const { user } = board({
    "POST /api/v1/enquiries/e-6/status": { status: 409, body: { detail: "Can't move an enquiry from new to quoting." } },
  });
  const card = await within(await column("New")).findByRole("article", { name: "E-0006 BOM → GOI" });
  await user.click(within(card).getByRole("button", { name: "Move E-0006" }));
  await user.click(await screen.findByRole("menuitem", { name: "Move to Quoting" }));
  expect(await screen.findByText("Can't move an enquiry from new to quoting.")).toBeInTheDocument();
  await waitFor(async () =>
    expect(within(await column("New")).getByRole("article", { name: "E-0006 BOM → GOI" })).toBeInTheDocument(),
  );
  expect(within(await column("Quoting")).queryByRole("article", { name: "E-0006 BOM → GOI" })).not.toBeInTheDocument();
});

test("dropping on a stage the enquiry can't move to does nothing; an allowed drop moves it", async () => {
  const { calls } = board({
    "POST /api/v1/enquiries/e-6/status": {
      status: 200,
      body: enquiryOut({ id: "e-6", number: "E-0006", origin: "BOM", destination: "GOI", status: "quoting", client: null }),
    },
  });
  const card = await within(await column("New")).findByRole("article", { name: "E-0006 BOM → GOI" });
  const won = await column("Won");
  fireEvent.dragStart(card);
  // An allowed target cancels dragover (accepting the drop); a disallowed one leaves it alone.
  expect(fireEvent.dragOver(won)).toBe(true);
  fireEvent.drop(won);
  fireEvent.dragEnd(card);
  expect(statusPosts(calls)).toHaveLength(0);
  expect(within(await column("New")).getByRole("article", { name: "E-0006 BOM → GOI" })).toBeInTheDocument();

  const quoting = await column("Quoting");
  fireEvent.dragStart(card);
  expect(fireEvent.dragOver(quoting)).toBe(false);
  fireEvent.drop(quoting);
  await waitFor(() => expect(statusPosts(calls)).toHaveLength(1));
  expect(statusPosts(calls)[0]?.body).toEqual({ status: "quoting" });
});

test("a won enquiry has no moves", async () => {
  board();
  const card = await within(await column("Won")).findByRole("article", { name: "E-0004 DEL → BOM" });
  expect(within(card).queryByRole("button", { name: /^Move/ })).not.toBeInTheDocument();
  expect(card).toHaveAttribute("draggable", "false");
});

test("the list view is a table whose rows open the enquiry", async () => {
  const { user, router } = board();
  await within(await column("New")).findAllByRole("article");
  await user.click(screen.getByRole("radio", { name: "List" }));
  const table = await screen.findByRole("table", { name: "Enquiries" });
  expect(within(table).getAllByRole("row")).toHaveLength(6);
  await user.click(within(table).getByText("E-0003"));
  await waitFor(() => expect(router.state.location.pathname).toBe("/app/enquiries/e-3"));
});

test("filters ask the server by assignee and search, and narrow by route", async () => {
  const { calls, user } = board();
  await within(await column("New")).findAllByRole("article");
  await user.selectOptions(screen.getByLabelText("Assignee"), "u-agent");
  await waitFor(() =>
    expect(calls.some((c) => c.path === "/api/v1/enquiries" && c.search.get("assignee") === "u-agent")).toBe(true),
  );
  await user.selectOptions(screen.getByLabelText("Assignee"), "");
  await user.type(screen.getByRole("searchbox", { name: "Search enquiries" }), "Priya");
  await waitFor(() => expect(calls.some((c) => c.path === "/api/v1/enquiries" && c.search.get("q") === "Priya")).toBe(true));
  await user.clear(screen.getByRole("searchbox", { name: "Search enquiries" }));

  await user.selectOptions(screen.getByLabelText("Route"), "DEL-BOM");
  await waitFor(() => expect(within(screen.getByRole("list", { name: "New enquiries" })).queryAllByRole("article")).toHaveLength(0));
  expect(within(screen.getByRole("list", { name: "Quoted enquiries" })).getAllByRole("article")).toHaveLength(1);
});

test("a failing board says what went wrong and retries", async () => {
  let fail = true;
  const { user } = board({
    "GET /api/v1/enquiries": () =>
      fail
        ? { status: 500, body: { detail: "Something went wrong on our side. Please try again." } }
        : { status: 200, body: { items: [], total: 0 } },
  });
  expect(await screen.findByText("Something went wrong on our side. Please try again.")).toBeInTheDocument();
  fail = false;
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText(/No new enquiries/)).toBeInTheDocument();
});
