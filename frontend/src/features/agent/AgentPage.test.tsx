import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { AgentRunDetail, AgentStep } from "../../api/agent";
import {
  agentRun,
  AVAILABLE_DEMO,
  AVAILABLE_MODEL,
  CONFIRM,
  PLAN_STEPS,
  planResult,
  QUESTION,
  RUN_ID,
  runDetail,
  UNAVAILABLE,
} from "../../test/agentFixtures";
import { installFakeEventSource, type FakeEventSource } from "../../test/fakeEventSource";
import { ME_OWNER } from "../../test/fixtures";
import { mockApi, type MockHandler } from "../../test/mockApi";
import { renderApp, withSession } from "../../test/renderApp";

vi.mock("../globe/webgl", () => ({ hasWebGL: () => false }));

const RUN_PATH = `/api/v1/agent/runs/${RUN_ID}`;
let Source: typeof FakeEventSource;

/** The three-column layout (from 1280 px); without this the page lays out for a phone. */
function wideScreen(wide = true) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: wide && query.includes("80rem"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  Source = installFakeEventSource();
  wideScreen();
});

function agentApp(path: string, detail: AgentRunDetail | null, extra: Record<string, MockHandler> = {}) {
  const api = mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/agent/availability": { status: 200, body: AVAILABLE_DEMO },
      "GET /api/v1/agent/runs": { status: 200, body: { items: detail ? [detail] : [] } },
      ...(detail ? { [`GET ${RUN_PATH}`]: { status: 200, body: detail } } : {}),
      ...extra,
    }),
  );
  return { ...api, ...renderApp(path) };
}

const running = (steps: AgentStep[] = []) =>
  runDetail({ status: "running", grounded: null, result: null, finished_at: null, steps });

/** The trace's rows, top to bottom, as text. */
async function traceRows() {
  const log = await screen.findByRole("log", { name: "Plan trace" });
  return within(log)
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");
}

test("streaming renders each step in order as it arrives, then the plan when the run is done", async () => {
  agentApp(`/app/agent/${RUN_ID}`, running());
  await screen.findByRole("log", { name: "Plan trace" });
  await waitFor(() => expect(Source.instances).toHaveLength(1));
  const source = Source.latest;
  expect(source.url).toBe(`${RUN_PATH}/events?last_event_id=-1`);
  source.open();
  expect(screen.getByText("Planning · searching live sources")).toBeInTheDocument();

  for (const step of PLAN_STEPS.slice(0, 4)) source.step(step);
  const rows = await traceRows();
  expect(rows).toHaveLength(3); // the request, then two tool rows (call and result together)
  expect(rows[1]).toContain("Looking up airports for “Delhi”");
  expect(rows[1]).toContain("Found 5 airports");
  expect(rows[1]).toContain("156 ms");
  expect(rows[2]).toContain("Searching flights DEL → DXB");
  expect(rows[2]).toContain("6 flight options from ₹60,863");

  for (const step of PLAN_STEPS.slice(4)) source.step(step);
  const after = await traceRows();
  expect(after.map((row) => row.slice(0, 40))).toEqual([
    expect.stringContaining("Request"),
    expect.stringContaining("Looking up airports"),
    expect.stringContaining("Searching flights"),
    expect.stringContaining("Checking the weather"),
    expect.stringContaining("Checked prices against live results"),
    expect.stringContaining("Plan summary"),
  ]);

  source.status(agentRun());
  expect(await screen.findByText("All prices verified against live results")).toBeInTheDocument();
  expect(source.closed).toBe(true);
  expect(screen.queryByText("Planning · searching live sources")).not.toBeInTheDocument();
});

test("a running tool shows as running until its result arrives, and a row expands to its data", async () => {
  const { user } = agentApp(`/app/agent/${RUN_ID}`, running(PLAN_STEPS.slice(0, 3)));
  const log = await screen.findByRole("log", { name: "Plan trace" });
  expect(within(log).getByText("Running…")).toBeInTheDocument();
  await waitFor(() => expect(Source.instances).toHaveLength(1));
  expect(Source.latest.lastEventId).toBe("2");
  Source.latest.step(PLAN_STEPS[3] as AgentStep);
  expect(within(log).queryByText("Running…")).not.toBeInTheDocument();
  await user.click(within(log).getByRole("button", { name: "Show details: Searching flights DEL → DXB" }));
  expect(within(log).getByRole("columnheader", { name: "Total" })).toBeInTheDocument();
  expect(within(log).getByText("6E 1078, 6E 740")).toBeInTheDocument();
  expect(within(log).getByText("₹83,310").parentElement).toHaveTextContent("≈ ₹83,310");
});

test("a dropped stream reconnects from the last seq it holds, and replayed steps never show twice", async () => {
  agentApp(`/app/agent/${RUN_ID}`, running());
  await waitFor(() => expect(Source.instances).toHaveLength(1));
  const first = Source.latest;
  first.open();
  first.step(PLAN_STEPS[0] as AgentStep);
  first.step(PLAN_STEPS[1] as AgentStep);
  first.fail();
  expect(first.closed).toBe(true);
  expect(await screen.findByText("Reconnecting to live updates…")).toBeInTheDocument();

  await waitFor(() => expect(Source.instances).toHaveLength(2), { timeout: 3000 });
  const second = Source.latest;
  expect(second.lastEventId).toBe("1");
  second.open();
  // The server replays from Last-Event-ID; a step seen before is ignored.
  second.step(PLAN_STEPS[1] as AgentStep);
  second.step(PLAN_STEPS[2] as AgentStep);
  second.step(PLAN_STEPS[3] as AgentStep);
  const rows = await traceRows();
  expect(rows.filter((row) => row.includes("Looking up airports"))).toHaveLength(1);
  expect(rows.filter((row) => row.includes("Searching flights DEL → DXB"))).toHaveLength(1);
  expect(screen.queryByText("Reconnecting to live updates…")).not.toBeInTheDocument();
});

test("a stream refused with 429 pauses live updates calmly and polls the run instead", async () => {
  const { calls } = agentApp(`/app/agent/${RUN_ID}`, running(), {
    [`GET ${RUN_PATH}/events`]: { status: 429, body: { detail: "Too many live views are open." } },
  });
  await waitFor(() => expect(Source.instances).toHaveLength(1));
  Source.latest.fail();
  expect(await screen.findByText(/Live updates paused, too many open views; refresh later/)).toBeInTheDocument();
  await waitFor(() => expect(calls.filter((c) => c.path === RUN_PATH).length).toBeGreaterThanOrEqual(2), { timeout: 4500 });
  expect(Source.instances).toHaveLength(1);
});

test("a question takes focus; the answer is sent as a reply and shows in the conversation", async () => {
  const waiting = runDetail({
    status: "waiting_for_user",
    prompt: "I want to go to Dubai",
    grounded: null,
    result: null,
    finished_at: null,
    pending: QUESTION,
    steps: [{ seq: 0, kind: "ask_user", payload: QUESTION, duration_ms: null, created_at: "2026-10-04T10:00:00Z" }],
  });
  const { calls, user } = agentApp(`/app/agent/${RUN_ID}`, waiting, {
    [`POST ${RUN_PATH}/reply`]: { status: 202, body: agentRun({ status: "queued", result: null, grounded: null, pending: null }) },
  });
  expect(await screen.findByText(QUESTION.question)).toBeInTheDocument();
  const answer = screen.getByRole("textbox", { name: "Your answer" });
  await waitFor(() => expect(answer).toHaveFocus());
  expect(screen.getByText("Departure date")).toBeInTheDocument();

  await user.type(answer, "From Mumbai, 20 to 24 Nov, 2 adults{Enter}");
  await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === `${RUN_PATH}/reply`)).toBe(true));
  expect(calls.find((c) => c.path === `${RUN_PATH}/reply`)?.body).toEqual({ text: "From Mumbai, 20 to 24 Nov, 2 adults" });
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "Your answer" })).not.toBeInTheDocument());

  Source.latest.step({ seq: 1, kind: "user", payload: { text: "From Mumbai, 20 to 24 Nov, 2 adults", call_id: QUESTION.call_id }, duration_ms: null, created_at: "2026-10-04T10:00:05Z" });
  const rows = await traceRows();
  expect(rows[2]).toContain("You");
  expect(rows[2]).toContain("From Mumbai, 20 to 24 Nov, 2 adults");
});

function confirming(warnings?: string[]) {
  const pending = warnings ? { ...CONFIRM, warnings } : CONFIRM;
  return runDetail({
    status: "waiting_for_user",
    pending,
    steps: [
      ...PLAN_STEPS.slice(0, 4),
      { seq: 4, kind: "tool_call", payload: { call_id: CONFIRM.call_id, tool: "create_enquiry", args: CONFIRM.args, label: "Creating an enquiry" }, duration_ms: null, created_at: "2026-10-04T10:00:04Z" },
      { seq: 5, kind: "ask_user", payload: pending, duration_ms: null, created_at: "2026-10-04T10:00:05Z" },
    ],
  });
}

test("a write waits on ConfirmActionCard; Approve sends approve true", async () => {
  const { calls, user } = agentApp(`/app/agent/${RUN_ID}`, confirming(["Two clients are named Priya Sharma; this uses the newest."]), {
    [`POST ${RUN_PATH}/confirm`]: { status: 202, body: agentRun({ status: "queued", pending: null }) },
  });
  const card = (await screen.findByText(CONFIRM.action)).closest("section") as HTMLElement;
  expect(within(card).getByRole("heading", { name: "Create enquiry" })).toBeInTheDocument();
  await waitFor(() => expect(card).toHaveFocus());
  expect(within(card).getByRole("list", { name: "Cautions" })).toHaveTextContent("Two clients are named Priya Sharma");
  await user.click(within(card).getByRole("button", { name: "Approve" }));
  await waitFor(() => expect(calls.some((c) => c.path === `${RUN_PATH}/confirm`)).toBe(true));
  expect(calls.find((c) => c.path === `${RUN_PATH}/confirm`)?.body).toEqual({ call_id: CONFIRM.call_id, approve: true });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument());
});

test("Decline sends approve false, and the decision shows in the trace", async () => {
  const { calls, user } = agentApp(`/app/agent/${RUN_ID}`, confirming(), {
    [`POST ${RUN_PATH}/confirm`]: { status: 202, body: agentRun({ status: "queued", pending: null }) },
  });
  await user.click(await screen.findByRole("button", { name: "Decline" }));
  await waitFor(() => expect(calls.find((c) => c.path === `${RUN_PATH}/confirm`)?.body).toEqual({ call_id: CONFIRM.call_id, approve: false }));
  Source.latest.step({ seq: 6, kind: "user", payload: { call_id: CONFIRM.call_id, decision: "declined", action: CONFIRM.action }, duration_ms: null, created_at: "2026-10-04T10:00:06Z" });
  const rows = await traceRows();
  expect(rows[rows.length - 1]).toContain("Declined");
});

test("a verified plan carries the verified badge; a fallback plan says some values couldn't be verified", async () => {
  agentApp(`/app/agent/${RUN_ID}`, runDetail());
  expect(await screen.findByText("All prices verified against live results")).toBeInTheDocument();
  expect(screen.queryByText(/couldn't be verified — showing results only/)).not.toBeInTheDocument();
  const board = screen.getByRole("region", { name: "Plan board" });
  expect(within(board).getByRole("article", { name: "F1 IndiGo ₹60,863" })).toBeInTheDocument();
  const converted = within(board).getByRole("article", { name: "F2 Emirates about ₹83,310" });
  expect(converted).toHaveTextContent("Billed $998.00");
  expect(within(board).getByText("Typical for these dates")).toBeInTheDocument();
  expect(within(board).getByText(/Weather data by Open-Meteo.com/)).toBeInTheDocument();
  expect(within(board).getByRole("region", { name: "Day by day" })).toHaveTextContent("Fly DEL 17:20 → DXB 20:39");
  expect(within(board).getByRole("link", { name: "Open in Fare search" })).toHaveAttribute(
    "href",
    "/app/fares?origin=DEL&destination=DXB&depart=2026-11-20&return=2026-11-24&adults=2&cabin=economy",
  );
});

test("a fallback plan is never shown as verified", async () => {
  agentApp(`/app/agent/${RUN_ID}`, runDetail({ grounded: false, result: planResult({ fallback: true }) }));
  expect(await screen.findByText("Some values couldn't be verified — showing results only")).toBeInTheDocument();
  expect(screen.queryByText("All prices verified against live results")).not.toBeInTheDocument();
});

test("model and supplier text renders as plain text: no links, no markup", async () => {
  const hostile = "See https://evil.example/pay and <script>alert(1)</script> **bold** <a href=\"https://x.example\">x</a>";
  agentApp(
    `/app/agent/${RUN_ID}`,
    runDetail({
      result: planResult({ summary: hostile }),
      steps: [...PLAN_STEPS.slice(0, 7), { seq: 7, kind: "answer", payload: { text: hostile, grounded: true, fallback: false }, duration_ms: 0, created_at: "2026-10-04T10:00:07Z" }],
    }),
  );
  const shown = await screen.findAllByText(hostile);
  expect(shown.length).toBeGreaterThanOrEqual(2);
  expect(document.querySelector("script")).toBeNull();
  expect(document.querySelector('a[href^="https://evil.example"], a[href^="https://x.example"]')).toBeNull();
  expect(document.querySelector("strong, b")).toBeNull();
});

test("Create enquiry on a finished plan asks the agent as a new request about the same trip", async () => {
  const created = "99999999-2222-4333-8444-555555555555";
  const { calls, user, router } = agentApp(`/app/agent/${RUN_ID}`, runDetail(), {
    "POST /api/v1/agent/runs": { status: 202, body: { run_id: created, status: "queued" } },
    [`GET /api/v1/agent/runs/${created}`]: { status: 200, body: { ...running(), id: created } },
  });
  await user.click(await screen.findByRole("button", { name: "Create enquiry" }));
  await waitFor(() => expect(router.state.location.pathname).toBe(`/app/agent/${created}`));
  expect(calls.find((c) => c.method === "POST" && c.path === "/api/v1/agent/runs")?.body).toEqual({
    prompt: "Create an enquiry for this trip: DEL to DXB, 20 Nov 2026 to 24 Nov 2026, 2 adults, economy.",
  });
});

test("Cancel stops a running plan", async () => {
  const { calls, user } = agentApp(`/app/agent/${RUN_ID}`, running(PLAN_STEPS.slice(0, 2)), {
    [`POST ${RUN_PATH}/cancel`]: { status: 200, body: agentRun({ status: "cancelled", result: null, grounded: null }) },
  });
  await user.click(await screen.findByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(calls.some((c) => c.path === `${RUN_PATH}/cancel`)).toBe(true));
  expect(await screen.findByText("Plan cancelled")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
});

test("failed and over-budget runs say what happened", async () => {
  agentApp(`/app/agent/${RUN_ID}`, runDetail({ status: "failed", result: null, grounded: null, error: "The plan was interrupted. Try again." }));
  expect(await screen.findByText("This plan didn't finish")).toBeInTheDocument();
  expect(screen.getByText("The plan was interrupted. Try again.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

test("a plan that used its budget is labelled", async () => {
  agentApp(`/app/agent/${RUN_ID}`, runDetail({ status: "budget_exceeded", result: null, grounded: null, error: "This month's agent budget is used up." }));
  expect(await screen.findByText("Plan stopped at its limit")).toBeInTheDocument();
  expect(screen.getByText("This month's agent budget is used up.")).toBeInTheDocument();
});

test("a new request is sent with Enter, opens the new plan, and a refusal shows the server's message", async () => {
  const created = "88888888-2222-4333-8444-555555555555";
  let refuse = true;
  const { calls, user, router } = agentApp("/app/agent", null, {
    "POST /api/v1/agent/runs": () =>
      refuse
        ? { status: 429, body: { detail: "Too many new plans this minute. Try again shortly." } }
        : { status: 202, body: { run_id: created, status: "queued" } },
    [`GET /api/v1/agent/runs/${created}`]: { status: 200, body: { ...running(), id: created } },
  });
  const box = await screen.findByRole("textbox", { name: "Trip request" });
  await user.type(box, "Delhi to Dubai for 2 adults, 20 Nov to 24 Nov{Enter}");
  expect(await screen.findByText("Too many new plans this minute. Try again shortly.")).toBeInTheDocument();
  expect(box).toHaveValue("Delhi to Dubai for 2 adults, 20 Nov to 24 Nov");
  refuse = false;
  await user.type(box, "{Shift>}{Enter}{/Shift}economy");
  expect(box).toHaveValue("Delhi to Dubai for 2 adults, 20 Nov to 24 Nov\neconomy");
  await user.click(screen.getByRole("button", { name: "Plan trip" }));
  await waitFor(() => expect(router.state.location.pathname).toBe(`/app/agent/${created}`));
  expect(calls.filter((c) => c.method === "POST" && c.path === "/api/v1/agent/runs").at(-1)?.body).toEqual({
    prompt: "Delhi to Dubai for 2 adults, 20 Nov to 24 Nov\neconomy",
  });
});

test("the composer counts characters up to 2,000 and offers suggested requests", async () => {
  const { user } = agentApp("/app/agent", null);
  const box = await screen.findByRole("textbox", { name: "Trip request" });
  expect(screen.getByText("0 / 2,000")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /DEL → DXB/ }));
  expect((box as HTMLTextAreaElement).value).toMatch(/^Delhi to Dubai for 2 adults, /);
  expect(box).toHaveFocus();
});

test("a prompt in the address prefills the request box without sending it", async () => {
  const { calls } = agentApp(`/app/agent?prompt=${encodeURIComponent("Plan a trip from DEL to BOM, for 2 adults, economy.")}`, null);
  expect(await screen.findByRole("textbox", { name: "Trip request" })).toHaveValue("Plan a trip from DEL to BOM, for 2 adults, economy.");
  expect(calls.some((c) => c.method === "POST")).toBe(false);
});

test("without a model the page says the agent is unavailable and no plan can start", async () => {
  agentApp("/app/agent", null, { "GET /api/v1/agent/availability": { status: 200, body: UNAVAILABLE } });
  expect(await screen.findAllByText("Agent unavailable — no model configured")).not.toHaveLength(0);
  expect(screen.getByRole("textbox", { name: "Trip request" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Plan trip" })).toBeDisabled();
});

test("the demo planner is labelled; a configured model is not", async () => {
  const { unmount } = agentApp("/app/agent", null);
  const header = await screen.findByRole("heading", { level: 1, name: "Agent" });
  expect(await within(header.parentElement as HTMLElement).findByText("Demo planner")).toBeInTheDocument();
  unmount();
  agentApp("/app/agent", null, { "GET /api/v1/agent/availability": { status: 200, body: AVAILABLE_MODEL } });
  expect(await screen.findByText("Model gemini-2.5-flash")).toBeInTheDocument();
  expect(screen.queryByText("Demo planner")).not.toBeInTheDocument();
});

test("the run list links each plan with its status", async () => {
  agentApp("/app/agent", runDetail());
  const list = await screen.findByRole("region", { name: "Recent plans" });
  const link = await within(list).findByRole("link", { name: /Delhi to Dubai/ });
  expect(link).toHaveAttribute("href", `/app/agent/${RUN_ID}`);
  expect(link).toHaveTextContent("Done");
});

test("on a phone the columns stack and a switch moves between the conversation and the plan", async () => {
  wideScreen(false);
  const { user } = agentApp(`/app/agent/${RUN_ID}`, runDetail());
  expect(await screen.findByRole("log", { name: "Plan trace" })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Plan board" })).not.toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "Conversation" })).toBeChecked();
  await user.click(screen.getByRole("radio", { name: "Plan" }));
  expect(screen.getByRole("region", { name: "Plan board" })).toBeInTheDocument();
  expect(screen.getByText("All prices verified against live results")).toBeInTheDocument();
  expect(screen.queryByRole("log", { name: "Plan trace" })).not.toBeInTheDocument();
});

test("an unknown plan says it wasn't found", async () => {
  agentApp(`/app/agent/${RUN_ID}`, null, { [`GET ${RUN_PATH}`]: { status: 404, body: { detail: "Plan not found." } } });
  expect(await screen.findByText("Plan not found")).toBeInTheDocument();
});
