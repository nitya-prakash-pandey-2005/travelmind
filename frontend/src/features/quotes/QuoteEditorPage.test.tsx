import { screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { QuoteDetail } from "../../api/quotes";
import { ME_OWNER } from "../../test/fixtures";
import { mockApi, type MockCall, type MockHandler } from "../../test/mockApi";
import { makeOffer, searchResponse } from "../../test/offerFixtures";
import { renderApp, withSession } from "../../test/renderApp";
import { commandCenterMocks, enquiryOut } from "../../test/workspaceFixtures";
import {
  AIR_INDIA,
  AKASA,
  dayFromToday,
  INDIGO,
  quoteDetail,
  quoteOption,
  quoteVersion,
  sentQuote,
  UNITED,
  VISTARA,
} from "./quoteFixtures";

vi.mock("../globe/webgl", () => ({ hasWebGL: () => false }));

const TEAM = [
  { id: "u-owner", email: "asha@alphatravels.in", full_name: "Asha Rao", role: "owner" },
  { id: "u-agent", email: "ravi@alphatravels.in", full_name: "Ravi Kumar", role: "agent" },
];

const ENQUIRY = {
  ...enquiryOut({ id: "e-5", number: "E-0005", origin: "DEL", destination: "BOM", status: "quoting", client: { id: "c-priya", name: "Priya Sharma" } }),
  depart_date: dayFromToday(21),
  return_date: null,
  adults: 1,
};

const TIMELINE = {
  items: [
    { id: "a1", kind: "quote.created", summary: "New quote Q-0004 for E-0005", occurred_at: new Date(Date.now() - 600 * 60_000).toISOString(), actor: { id: "u-owner", full_name: "Asha Rao" } },
  ],
};

const SEARCH = searchResponse({ offers: [INDIGO, AIR_INDIA, VISTARA, AKASA, UNITED] });

/** Writes that answer with the quote also change what later reads of it return. */
const QUOTE_WRITES = ["POST /api/v1/quotes/q-4/versions", "POST /api/v1/quotes/q-4/status"];

function editor(quote: QuoteDetail, extra: Record<string, MockHandler> = {}) {
  let current = quote;
  const routes: Record<string, MockHandler> = { ...extra };
  for (const key of QUOTE_WRITES) {
    const handler = extra[key];
    if (!handler || typeof handler === "function") continue;
    routes[key] = () => {
      if (handler.status < 300) current = handler.body as QuoteDetail;
      return handler;
    };
  }
  const api = mockApi(
    withSession(ME_OWNER, {
      ...commandCenterMocks({ populated: true }),
      "GET /api/v1/team": { status: 200, body: TEAM },
      "GET /api/v1/quotes/q-4": () => ({ status: 200, body: current }),
      "GET /api/v1/quotes/q-4/activity": { status: 200, body: TIMELINE },
      "GET /api/v1/enquiries/e-5": { status: 200, body: ENQUIRY },
      "POST /api/v1/flights/search": { status: 200, body: SEARCH },
      ...routes,
    }),
  );
  return { ...api, ...renderApp("/app/quotes/q-4") };
}

const offerCard = (name: RegExp) => screen.getByRole("article", { name });
const addBox = (name: RegExp) => within(offerCard(name)).getByRole("checkbox", { name: "Add to quote" });

async function searchAndPick(user: ReturnType<typeof renderApp>["user"], cards: RegExp[]) {
  await user.click(await screen.findByRole("button", { name: "Scan fares" }));
  await screen.findByRole("list", { name: "Flight offers" });
  for (const card of cards) await user.click(addBox(card));
}

const versionCalls = (calls: MockCall[]) => calls.filter((c) => c.method === "POST" && c.path === "/api/v1/quotes/q-4/versions");

/** The body of the first version saved; fails the test when none was. */
function savedBody(calls: MockCall[]): Record<string, unknown> {
  const call = versionCalls(calls)[0];
  expect(call).toBeDefined();
  return (call?.body ?? {}) as Record<string, unknown>;
}

const quoteReads = (calls: MockCall[]) => calls.filter((c) => c.method === "GET" && c.path === "/api/v1/quotes/q-4").length;

test("the builder never posts prices: offers by id, the message and markups only; the preview is the server's", async () => {
  // The server prices the version: these sells are deliberately not offer total + 10%.
  const saved = quoteDetail({
    versions: [quoteVersion(1, [quoteOption(INDIGO, 52_340, 575_740), quoteOption(AIR_INDIA, 61_200, 673_250)], { message: "Two morning flights." })],
  });
  const { user, calls } = editor(quoteDetail(), {
    "POST /api/v1/quotes/q-4/versions": { status: 201, body: saved },
  });
  // The file's first test also pays for the app's first render; give it room under full-suite load.
  expect(await screen.findByRole("heading", { level: 1, name: "Q-0004" }, { timeout: 5000 })).toBeInTheDocument();
  await searchAndPick(user, [/^IndiGo/, /^Air India/]);
  await user.type(screen.getByLabelText("Message to the client"), "Two morning flights.");
  await user.click(screen.getByRole("button", { name: "Save version" }));

  await waitFor(() => expect(versionCalls(calls)).toHaveLength(1));
  const body = savedBody(calls);
  expect(Object.keys(body).sort()).toEqual(["message", "offer_ids", "option_markups"]);
  expect(body.offer_ids).toEqual(["sandbox~6e", "sandbox~ai"]);
  expect(body.option_markups).toEqual([1000, 1000]);
  expect(body.message).toBe("Two morning flights.");
  expect(JSON.stringify(body)).not.toMatch(/amount|minor|sell|total|price|currency/);

  const preview = await screen.findByRole("region", { name: "Version 1 preview" });
  expect(within(preview).getByText("₹5,757.40")).toBeInTheDocument();
  expect(within(preview).getByText("₹6,732.50")).toBeInTheDocument();
  expect(within(preview).getByText("₹523.40")).toBeInTheDocument();
  expect(within(preview).getByText("Two morning flights.")).toBeInTheDocument();
});

test("a percent markup is sent in basis points, per-option overrides included", async () => {
  const { user, calls } = editor(quoteDetail(), {
    "POST /api/v1/quotes/q-4/versions": { status: 201, body: quoteDetail({ versions: [quoteVersion(1, [quoteOption(INDIGO, 1)])] }) },
  });
  await searchAndPick(user, [/^IndiGo/, /^Air India/]);
  const markup = screen.getByLabelText("Markup for every option");
  await user.clear(markup);
  await user.type(markup, "8.5");
  await user.type(screen.getByLabelText("Markup for option 2"), "12");
  await user.click(screen.getByRole("button", { name: "Save version" }));
  await waitFor(() => expect(versionCalls(calls)).toHaveLength(1));
  expect(savedBody(calls).option_markups).toEqual([850, 1200]);
});

test("a fixed markup is typed in rupees and sent in paise", async () => {
  const { user, calls } = editor(quoteDetail({ markup_kind: "fixed", markup_value: 50_000 }), {
    "POST /api/v1/quotes/q-4/versions": { status: 201, body: quoteDetail({ versions: [quoteVersion(1, [quoteOption(INDIGO, 1)])] }) },
  });
  await searchAndPick(user, [/^IndiGo/, /^Air India/]);
  expect(screen.getByLabelText("Markup for every option")).toHaveValue("500");
  await user.type(screen.getByLabelText("Markup for option 1"), "250.50");
  await user.click(screen.getByRole("button", { name: "Save version" }));
  await waitFor(() => expect(versionCalls(calls)).toHaveLength(1));
  expect(savedBody(calls).option_markups).toEqual([25_050, 50_000]);
});

test("an invalid markup blocks saving with a reason", async () => {
  const { user, calls } = editor(quoteDetail());
  await searchAndPick(user, [/^IndiGo/]);
  const markup = screen.getByLabelText("Markup for every option");
  await user.clear(markup);
  await user.type(markup, "150");
  expect(screen.getByText("Up to 100%.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save version" })).toBeDisabled();
  expect(versionCalls(calls)).toHaveLength(0);
});

test("only offers billed in the quote currency can be added, up to three", async () => {
  const { user } = editor(quoteDetail());
  await searchAndPick(user, []);
  const united = addBox(/^United/);
  expect(united).toBeDisabled();
  expect(within(offerCard(/^United/)).getByText("Billed in USD — can't be added to an INR quote")).toBeInTheDocument();

  for (const card of [/^IndiGo/, /^Air India/, /^Vistara/]) await user.click(addBox(card));
  expect(addBox(/^Akasa Air/)).toBeDisabled();
  expect(within(offerCard(/^Akasa Air/)).getByText("Up to 3 options per version")).toBeInTheDocument();
  const options = screen.getByRole("list", { name: "Options in this version" });
  expect(within(options).getAllByRole("listitem")).toHaveLength(3);

  await user.click(within(options).getByRole("button", { name: "Remove option 1" }));
  expect(addBox(/^IndiGo/)).not.toBeChecked();
  expect(addBox(/^Akasa Air/)).toBeEnabled();
});

test("re-price selected checks each option with its supplier, toasts a change and saves the fresh offer", async () => {
  const fresh = makeOffer({ id: "sandbox~6e-2", total: { amount_minor: 540_000, currency: "INR" } });
  const { user, calls } = editor(quoteDetail(), {
    "POST /api/v1/flights/offers/sandbox~6e/price": {
      status: 200,
      body: { offer: fresh, price_changed: true, previous_total: INDIGO.total },
    },
    "POST /api/v1/flights/offers/sandbox~ai/price": {
      status: 200,
      body: { offer: AIR_INDIA, price_changed: false, previous_total: AIR_INDIA.total },
    },
    "POST /api/v1/quotes/q-4/versions": { status: 201, body: quoteDetail({ versions: [quoteVersion(1, [quoteOption(fresh, 54_000)])] }) },
  });
  await searchAndPick(user, [/^IndiGo/, /^Air India/]);
  await user.click(screen.getByRole("button", { name: "Re-price and save" }));
  await waitFor(() => expect(versionCalls(calls)).toHaveLength(1));
  expect(savedBody(calls).offer_ids).toEqual(["sandbox~6e-2", "sandbox~ai"]);
  expect(await screen.findByText(/IndiGo is now ₹5,400 \(was ₹5,234\)/)).toBeInTheDocument();
});

test("version history shows each version's range, the change from the one before and what the client sees", async () => {
  editor(sentQuote());
  await screen.findByRole("heading", { level: 1, name: "Q-0004" });
  const history = screen.getByRole("region", { name: "Versions" });
  const items = within(history).getAllByRole("listitem");
  expect(items).toHaveLength(3);
  // Cheapest options: v3 ₹5,757.40, v2 ₹6,732, v1 ₹7,711 — changes in whole rupees.
  expect(within(items[0] as HTMLElement).getByText("▼ ₹975")).toBeInTheDocument();
  expect(within(items[1] as HTMLElement).getByText("Client sees this version")).toBeInTheDocument();
  expect(within(items[2] as HTMLElement).getByText("First version")).toBeInTheDocument();
  expect(within(items[1] as HTMLElement).getByText("▼ ₹979")).toBeInTheDocument();
});

test("send to client needs a version", async () => {
  editor(quoteDetail());
  expect(await screen.findByRole("button", { name: "Send to client" })).toBeDisabled();
});

test("the send dialog creates the link once and copies it and the WhatsApp message", async () => {
  const quote = quoteDetail({ versions: [quoteVersion(1, [quoteOption(INDIGO, 52_340, 576_000)])] });
  const { user, calls } = editor(quote, {
    "POST /api/v1/quotes/q-4/send": {
      status: 200,
      body: { share_url: "/q/tok_abc", token: "tok_abc", expires_at: "2026-10-17T09:00:00Z" },
    },
  });
  await user.click(await screen.findByRole("button", { name: "Send to client" }));
  const dialog = screen.getByRole("dialog", { name: "Send Q-0004 to the client" });
  expect(within(dialog).queryByText(/stops working/)).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Create link" }));
  const link = `${window.location.origin}/q/tok_abc`;
  expect(await within(dialog).findByLabelText("Client link")).toHaveValue(link);
  expect(calls.filter((c) => c.method === "POST" && c.path === "/api/v1/quotes/q-4/send")).toHaveLength(1);
  expect(within(dialog).getByText(/shown once/i)).toBeInTheDocument();

  const writeText = vi.spyOn(navigator.clipboard, "writeText");
  await user.click(within(dialog).getByRole("button", { name: "Copy link" }));
  expect(writeText).toHaveBeenLastCalledWith(link);
  await user.click(within(dialog).getByRole("button", { name: "Copy WhatsApp message" }));
  const text = writeText.mock.lastCall?.[0] ?? "";
  expect(text).toContain("Hello Priya,");
  expect(text).toContain("Option 1 · IndiGo · DEL 06:10 → BOM 08:20 · ₹5,760");
  expect(text).toContain("valid until 17 Oct 2026");
  expect(text).toContain(link);
});

test("re-sending warns that the old link stops working", async () => {
  const { user } = editor(sentQuote());
  await user.click(await screen.findByRole("button", { name: "Re-send to client" }));
  const dialog = screen.getByRole("dialog", { name: "Send Q-0004 to the client" });
  expect(within(dialog).getByText(/The link you sent before stops working/)).toBeInTheDocument();
  expect(within(dialog).getByText(/sees version 2/)).toBeInTheDocument();
});

test("a sent quote can be marked accepted, declined or expired; a draft can't", async () => {
  const { user, calls } = editor(sentQuote({ status: "viewed" }), {
    "POST /api/v1/quotes/q-4/status": { status: 200, body: sentQuote({ status: "accepted" }) },
  });
  await user.click(await screen.findByRole("button", { name: "Record outcome" }));
  expect(screen.getByRole("menuitem", { name: "Mark declined" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Mark expired" })).toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: "Mark accepted" }));
  const dialog = screen.getByRole("dialog", { name: "Mark Q-0004 accepted?" });
  await user.click(within(dialog).getByRole("button", { name: "Mark accepted" }));
  await waitFor(() =>
    expect(calls.find((c) => c.method === "POST" && c.path === "/api/v1/quotes/q-4/status")?.body).toEqual({ status: "accepted" }),
  );
});

test("a draft has no outcome actions", async () => {
  editor(quoteDetail());
  await screen.findByRole("heading", { level: 1, name: "Q-0004" });
  expect(screen.queryByRole("button", { name: "Record outcome" })).not.toBeInTheDocument();
});

test("an unknown quote shows a not-found state", async () => {
  mockApi(
    withSession(ME_OWNER, {
      ...commandCenterMocks({ populated: true }),
      "GET /api/v1/quotes/q-9": { status: 404, body: { detail: "Quote not found." } },
    }),
  );
  renderApp("/app/quotes/q-9");
  expect(await screen.findByText("Quote not found")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Back to quotes" })).toHaveAttribute("href", "/app/quotes");
});

test("after a save the selection clears and the preview shows the new version", async () => {
  const saved = quoteDetail({ versions: [quoteVersion(1, [quoteOption(INDIGO, 52_340)])] });
  const { user } = editor(quoteDetail(), { "POST /api/v1/quotes/q-4/versions": { status: 201, body: saved } });
  await searchAndPick(user, [/^IndiGo/]);
  await user.click(screen.getByRole("button", { name: "Save version" }));
  expect(await screen.findByRole("region", { name: "Version 1 preview" })).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Options in this version" })).not.toBeInTheDocument();
  expect(addBox(/^IndiGo/)).not.toBeChecked();
});

test("reuse options from the latest version saves those offers again", async () => {
  const { user, calls } = editor(sentQuote(), {
    "POST /api/v1/quotes/q-4/versions": { status: 201, body: sentQuote({ current_version: 4 }) },
  });
  await user.click(await screen.findByRole("button", { name: "Reuse options from v3" }));
  const options = screen.getByRole("list", { name: "Options in this version" });
  expect(within(options).getAllByRole("listitem")).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "Save version" }));
  await waitFor(() => expect(versionCalls(calls)).toHaveLength(1));
  expect(savedBody(calls).offer_ids).toEqual(["sandbox~6e", "sandbox~ai"]);
  expect(savedBody(calls).message).toBe("Two morning options.");
});

const CONFLICT = { status: 409, body: { detail: "This quote was already accepted, so it can't be changed." } };

test("a conflict on save shows the server's reason and refetches the quote", async () => {
  const { user, calls } = editor(quoteDetail(), { "POST /api/v1/quotes/q-4/versions": CONFLICT });
  await searchAndPick(user, [/^IndiGo/]);
  const reads = quoteReads(calls);
  await user.click(screen.getByRole("button", { name: "Save version" }));
  expect(await screen.findByText("This quote was already accepted, so it can't be changed.")).toBeInTheDocument();
  await waitFor(() => expect(quoteReads(calls)).toBeGreaterThan(reads));
});

test("a conflict on send shows the server's reason and refetches the quote", async () => {
  const quote = quoteDetail({ versions: [quoteVersion(1, [quoteOption(INDIGO, 0)])] });
  const { user, calls } = editor(quote, { "POST /api/v1/quotes/q-4/send": CONFLICT });
  await user.click(await screen.findByRole("button", { name: "Send to client" }));
  const reads = quoteReads(calls);
  const dialog = screen.getByRole("dialog", { name: "Send Q-0004 to the client" });
  await user.click(within(dialog).getByRole("button", { name: "Create link" }));
  expect(await within(dialog).findByText("This quote was already accepted, so it can't be changed.")).toBeInTheDocument();
  await waitFor(() => expect(quoteReads(calls)).toBeGreaterThan(reads));
});

test("a conflict on an outcome shows the server's reason and refetches the quote", async () => {
  const { user, calls } = editor(sentQuote(), {
    "POST /api/v1/quotes/q-4/status": { status: 409, body: { detail: "This quote was already declined, so it can't be changed." } },
  });
  await user.click(await screen.findByRole("button", { name: "Record outcome" }));
  await user.click(screen.getByRole("menuitem", { name: "Mark accepted" }));
  const reads = quoteReads(calls);
  const dialog = screen.getByRole("dialog", { name: "Mark Q-0004 accepted?" });
  await user.click(within(dialog).getByRole("button", { name: "Mark accepted" }));
  expect(await within(dialog).findByText("This quote was already declined, so it can't be changed.")).toBeInTheDocument();
  await waitFor(() => expect(quoteReads(calls)).toBeGreaterThan(reads));
});

test("closing the send dialog before copying the link asks first; a failed copy says so", async () => {
  const quote = quoteDetail({ versions: [quoteVersion(1, [quoteOption(INDIGO, 0)])] });
  const { user } = editor(quote, {
    "POST /api/v1/quotes/q-4/send": { status: 200, body: { share_url: "/q/tok_abc", token: "tok_abc", expires_at: "2026-10-17T09:00:00Z" } },
  });
  await user.click(await screen.findByRole("button", { name: "Send to client" }));
  const dialog = screen.getByRole("dialog", { name: "Send Q-0004 to the client" });
  await user.click(within(dialog).getByRole("button", { name: "Create link" }));
  await within(dialog).findByLabelText("Client link");
  await user.click(within(dialog).getByRole("button", { name: "Done" }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent("You haven't copied the link yet.");
  await user.click(within(dialog).getByRole("button", { name: "Go back" }));

  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
  await user.click(within(dialog).getByRole("button", { name: "Copy link" }));
  expect(await screen.findByText("Couldn't copy — select the link")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Client link")).toHaveValue(`${window.location.origin}/q/tok_abc`);

  await user.click(within(dialog).getByRole("button", { name: "Done" }));
  await user.click(within(dialog).getByRole("button", { name: "Close without copying" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

test("a per-traveller price shows only for an adults-only party", async () => {
  const party = makeOffer({ passenger_count: 3, total: { amount_minor: 900_000, currency: "INR" } });
  editor(quoteDetail({ versions: [quoteVersion(1, [quoteOption(party, 1)])] }), {
    "GET /api/v1/enquiries/e-5": { status: 200, body: { ...ENQUIRY, adults: 3 } },
  });
  const preview = await screen.findByRole("region", { name: "Version 1 preview" });
  // ₹9,000.01 for three: half-up to ₹3,000, as on the client's page.
  expect(await within(preview).findByText("₹3,000")).toBeInTheDocument();
});

test("a party with children shows the total only", async () => {
  const party = makeOffer({ passenger_count: 3, total: { amount_minor: 900_000, currency: "INR" } });
  editor(quoteDetail({ versions: [quoteVersion(1, [quoteOption(party, 0)])] }), {
    "GET /api/v1/enquiries/e-5": { status: 200, body: { ...ENQUIRY, adults: 2, children_ages: [7] } },
  });
  const preview = await screen.findByRole("region", { name: "Version 1 preview" });
  expect(await within(preview).findByText("total price only")).toBeInTheDocument();
  expect(within(preview).queryByText("Per traveller")).not.toBeInTheDocument();
});

test("the trip budget shows in whole units and the headline figures compactly", async () => {
  editor(quoteDetail({ versions: [quoteVersion(1, [quoteOption(INDIGO, 52_340, 575_740), quoteOption(AIR_INDIA, 61_200, 673_250)])] }), {
    "GET /api/v1/enquiries/e-5": { status: 200, body: { ...ENQUIRY, budget: { amount_minor: 6_000_049, currency: "INR" } } },
  });
  const trip = await screen.findByRole("region", { name: "Trip" });
  expect(await within(trip).findByText("₹60,000")).toBeInTheDocument();
  expect(trip).not.toHaveTextContent("₹60,000.49");
  const figures = screen.getByRole("region", { name: "Quote figures" });
  const cheapest = within(figures).getByRole("group", { name: "Cheapest option: ₹5.8K" });
  expect(cheapest).toHaveTextContent("Up to ₹6.7K");
  // The breakdown keeps exact paise.
  expect(within(screen.getByRole("region", { name: "Version 1 preview" })).getByText("₹5,757.40")).toBeInTheDocument();
});

test("Change search keeps the trip's children and offers one Scan fares, the form's", async () => {
  const { user, calls } = editor(quoteDetail(), {
    "GET /api/v1/enquiries/e-5": { status: 200, body: { ...ENQUIRY, adults: 2, children_ages: [7] } },
  });
  await user.click(await screen.findByRole("button", { name: "Change search" }));
  const form = await screen.findByRole("form", { name: "Search flights" });
  expect(within(form).getByText("1 (age 7)")).toBeInTheDocument();
  await waitFor(() => expect(within(form).getByRole("button", { name: "Change To" })).toBeInTheDocument());
  expect(screen.getAllByRole("button", { name: "Scan fares" })).toHaveLength(1);
  await user.click(within(form).getByRole("button", { name: "Scan fares" }));
  await screen.findByRole("list", { name: "Flight offers" });
  expect(calls.find((c) => c.path === "/api/v1/flights/search")?.body).toMatchObject({ adults: 2, children_ages: [7] });
});
