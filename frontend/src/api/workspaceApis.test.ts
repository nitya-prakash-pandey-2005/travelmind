import { MutationObserver, QueryObserver, type QueryClient } from "@tanstack/react-query";
import { expect, test } from "vitest";
import { resetSessionState } from "../auth/resetSessionState";
import { mockApi } from "../test/mockApi";
import { makeOffer } from "../test/offerFixtures";
import { enquiryOut } from "../test/workspaceFixtures";
import {
  clientActivityQueryOptions,
  clientKeys,
  clientQueryOptions,
  clientsApi,
  clientsQueryOptions,
  createClientMutation,
  deleteClientMutation,
  updateClientMutation,
  type ClientOut,
} from "./clients";
import { dashboardKeys } from "./dashboard";
import {
  ENQUIRY_TRANSITIONS,
  enquiriesApi,
  enquiriesQueryOptions,
  enquiryActivityQueryOptions,
  enquiryKeys,
  enquiryQueryOptions,
  setEnquiryStatusMutation,
  updateEnquiryMutation,
} from "./enquiries";
import {
  INDICATIVE_PRICE_LABEL,
  LIVE_PRICE_LABEL,
  publicQuoteDecisionMutation,
  publicQuoteKeys,
  publicQuoteQueryOptions,
  publicQuotesApi,
  type PublicQuote,
} from "./publicQuotes";
import { qk } from "./queries";
import { createQueryClient } from "./queryClient";
import {
  addQuoteVersionMutation,
  createQuoteMutation,
  decideQuoteMutation,
  quoteActivityQueryOptions,
  quoteKeys,
  quoteQueryOptions,
  quotesQueryOptions,
  sendQuoteMutation,
  shareUrl,
  type QuoteDetail,
} from "./quotes";
import { routeIntelKeys, routeIntelQueryOptions, type RouteIntel } from "./routeIntel";
import { workspaceKeys } from "./workspace";

const ENQUIRY = enquiryOut({
  id: "e-5",
  number: "E-0005",
  origin: "DEL",
  destination: "BOM",
  status: "quoted",
  client: { id: "c-priya", name: "Priya Sharma" },
});

const CLIENT: ClientOut = {
  id: "c-priya",
  kind: "individual",
  name: "Priya Sharma",
  email: "priya@example.com",
  phone: null,
  company_name: null,
  home_airport: "DEL",
  notes: null,
  tags: ["vip"],
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-01T10:00:00Z",
  enquiry_count: 2,
  quote_count: 1,
  won_value_minor: 1_250_000,
  currency: "INR",
  last_trip: { origin: "DEL", destination: "BOM", depart_date: "2026-09-20" },
  next_trip: { origin: "DEL", destination: "GOI", depart_date: "2026-10-20" },
};

const QUOTE: QuoteDetail = {
  id: "q-4",
  number: "Q-0004",
  status: "draft",
  currency: "INR",
  client: { id: "c-priya", name: "Priya Sharma" },
  enquiry: { id: "e-5", number: "E-0005", origin: "DEL", destination: "BOM", depart_date: "2026-10-20" },
  current_version: 1,
  sent_version: null,
  min_sell_minor: 575_740,
  sent_at: null,
  created_at: "2026-10-01T09:00:00Z",
  markup_kind: "percent",
  markup_value: 1000,
  share_expires_at: null,
  first_viewed_at: null,
  decided_at: null,
  accepted_option: null,
  versions: [
    {
      version: 1,
      message: "Two good options for your Mumbai trip.",
      options: [{ offer: makeOffer(), markup_minor: 52_340, sell: { amount_minor: 575_740, currency: "INR" } }],
      totals: { currency: "INR", min_sell_minor: 575_740, max_sell_minor: 575_740, options: 1 },
      created_at: "2026-10-01T09:05:00Z",
      created_by: "u-owner",
    },
  ],
};

const TIMELINE = {
  items: [
    {
      id: "a-1",
      kind: "quote.viewed",
      summary: "Client opened Q-0004",
      occurred_at: "2026-10-02T08:00:00Z",
      actor: null,
    },
    {
      id: "a-2",
      kind: "enquiry.created",
      summary: "E-0005 created",
      occurred_at: "2026-10-01T08:00:00Z",
      actor: { id: "u-owner", full_name: "Asha Rao" },
    },
  ],
};

const PUBLIC_QUOTE: PublicQuote = {
  number: "Q-0004",
  status: "viewed",
  agency: { name: "Alpha Travels", brand_color: "#22d3ee" },
  client_first_name: "Priya",
  message: "Two good options for your Mumbai trip.",
  options: [
    {
      index: 0,
      carrier_code: "6E",
      carrier_name: "IndiGo",
      cabin: "economy",
      slices: [
        {
          origin: "DEL",
          destination: "BOM",
          departing_at: "2026-10-20T06:10:00",
          arriving_at: "2026-10-20T08:20:00",
          duration_minutes: 130,
          stops: 0,
          segments: [
            {
              marketing_carrier: "6E",
              flight_number: "2134",
              origin: "DEL",
              destination: "BOM",
              departing_at: "2026-10-20T06:10:00",
              arriving_at: "2026-10-20T08:20:00",
            },
          ],
        },
      ],
      baggage: { checked: 1, carry_on: 1 },
      refundable: false,
      changeable: true,
      co2_kg_per_passenger: 98,
      price_label: INDICATIVE_PRICE_LABEL,
      sell: { amount_minor: 575_740, currency: "INR" },
      per_traveller: null,
    },
  ],
  currency: "INR",
  expires_at: "2026-10-15T09:00:00Z",
  decided_at: null,
  accepted_option: null,
};

const INTEL: RouteIntel = {
  origin: "DEL",
  destination: "BOM",
  cabin: "economy",
  currency: "INR",
  family: "market",
  daily: [{ date: "2026-10-01", p25_minor: 450_000, median_minor: 520_000, p75_minor: 610_000, samples: 12 }],
  by_days_out: [{ bucket: "8-21", median_minor: 510_000, samples: 9 }],
  carriers: [{ code: "6E", samples: 7, median_minor: 495_000 }],
  your_searches: [{ created_at: "2026-10-01T07:00:00Z", cheapest_minor: 480_000, adults: 1 }],
  updated_at: "2026-10-01T07:00:00Z",
};

/** Cached data for every list the workspace mutations must refresh. */
function seedWorkspace(client: QueryClient) {
  const keys = [
    dashboardKeys.summary("30d"),
    dashboardKeys.pipeline,
    workspaceKeys.onboarding,
    enquiryKeys.list({}),
    quoteKeys.list({}),
    clientKeys.list({}),
    dashboardKeys.clients("pri"),
  ];
  for (const key of keys) client.setQueryData(key, { seeded: true });
  return keys;
}

function expectInvalidated(client: QueryClient, keys: readonly (readonly unknown[])[]) {
  for (const key of keys) expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
}

// --- enquiries ------------------------------------------------------------------------------------

test("enquiries are listed with their filters and read one at a time", async () => {
  const { calls } = mockApi({
    "GET /api/v1/enquiries": { status: 200, body: { items: [ENQUIRY], total: 1 } },
    "GET /api/v1/enquiries/e-5": { status: 200, body: ENQUIRY },
    "GET /api/v1/enquiries/e-5/activity": { status: 200, body: TIMELINE },
  });
  const client = createQueryClient({ retry: false });
  const list = await client.fetchQuery(
    enquiriesQueryOptions({ status: "quoted", assignee: "u-owner", q: "priya", limit: 100 }),
  );
  expect(list.total).toBe(1);
  const search = calls[0]!.search;
  expect(Object.fromEntries(search)).toEqual({ status: "quoted", assignee: "u-owner", q: "priya", limit: "100" });

  expect((await client.fetchQuery(enquiryQueryOptions("e-5"))).number).toBe("E-0005");
  const timeline = await client.fetchQuery(enquiryActivityQueryOptions("e-5"));
  expect(timeline.items.map((item) => item.actor?.full_name ?? null)).toEqual([null, "Asha Rao"]);
});

test("a blank search term is not sent", async () => {
  const { calls } = mockApi({ "GET /api/v1/enquiries": { status: 200, body: { items: [], total: 0 } } });
  await enquiriesApi.list({ q: "   " });
  expect(calls[0]!.search.has("q")).toBe(false);
});

test("enquiry moves follow the backend's transitions", () => {
  expect(ENQUIRY_TRANSITIONS).toEqual({
    new: ["quoting", "quoted", "lost"],
    quoting: ["quoted", "lost"],
    quoted: ["won", "lost", "quoting"],
    lost: ["new"],
    won: [],
  });
});

test("editing an enquiry patches only the changed fields and refreshes the workspace", async () => {
  const updated = { ...ENQUIRY, notes: "Window seats" };
  const { calls } = mockApi({ "PATCH /api/v1/enquiries/e-5": { status: 200, body: updated } });
  const client = createQueryClient({ retry: false });
  const keys = seedWorkspace(client);
  const observer = new MutationObserver(client, updateEnquiryMutation(client));
  await observer.mutate({ id: "e-5", changes: { notes: "Window seats", return_date: null } });
  expect(calls[0]!.body).toEqual({ notes: "Window seats", return_date: null });
  expect(client.getQueryData(enquiryKeys.detail("e-5"))).toEqual(updated);
  expectInvalidated(client, keys);
});

test("moving an enquiry posts the status and the reason for a loss", async () => {
  const { calls } = mockApi({
    "POST /api/v1/enquiries/e-5/status": { status: 200, body: { ...ENQUIRY, status: "lost", lost_reason: "Price" } },
  });
  const client = createQueryClient({ retry: false });
  const keys = seedWorkspace(client);
  const observer = new MutationObserver(client, setEnquiryStatusMutation(client));
  await observer.mutate({ id: "e-5", status: "lost", lost_reason: "Price" });
  expect(calls[0]!.body).toEqual({ status: "lost", lost_reason: "Price" });
  expectInvalidated(client, keys);
});

// --- quotes ---------------------------------------------------------------------------------------

test("quotes are listed by status, client or enquiry and read with their versions", async () => {
  const { calls } = mockApi({
    "GET /api/v1/quotes": { status: 200, body: { items: [QUOTE], total: 1 } },
    "GET /api/v1/quotes/q-4": { status: 200, body: QUOTE },
    "GET /api/v1/quotes/q-4/activity": { status: 200, body: TIMELINE },
  });
  const client = createQueryClient({ retry: false });
  await client.fetchQuery(quotesQueryOptions({ status: "sent", client_id: "c-priya", enquiry_id: "e-5" }));
  expect(Object.fromEntries(calls[0]!.search)).toEqual({ status: "sent", client_id: "c-priya", enquiry_id: "e-5" });
  const detail = await client.fetchQuery(quoteQueryOptions("q-4"));
  expect(detail.versions[0]?.options[0]?.sell.amount_minor).toBe(575_740);
  expect((await client.fetchQuery(quoteActivityQueryOptions("q-4"))).items).toHaveLength(2);
});

test("creating a quote seeds its detail and refreshes the workspace", async () => {
  const { calls } = mockApi({ "POST /api/v1/quotes": { status: 201, body: QUOTE } });
  const client = createQueryClient({ retry: false });
  const keys = seedWorkspace(client);
  const observer = new MutationObserver(client, createQuoteMutation(client));
  const created = await observer.mutate({ enquiry_id: "e-5", markup_kind: "percent", markup_value: 1000 });
  expect(created.id).toBe("q-4");
  expect(calls[0]!.body).toEqual({ enquiry_id: "e-5", markup_kind: "percent", markup_value: 1000 });
  expect(client.getQueryData(quoteKeys.detail("q-4"))).toEqual(QUOTE);
  expectInvalidated(client, [...keys, enquiryKeys.list({})]);
});

test("a new version sends offer ids, the message and markups — never prices", async () => {
  const { calls } = mockApi({ "POST /api/v1/quotes/q-4/versions": { status: 201, body: QUOTE } });
  const client = createQueryClient({ retry: false });
  const keys = seedWorkspace(client);
  const observer = new MutationObserver(client, addQuoteVersionMutation(client));
  await observer.mutate({
    id: "q-4",
    version: { offer_ids: ["sandbox~ref-1", "sandbox~ref-2"], message: "Options", option_markups: [null, 500] },
  });
  expect(calls[0]!.body).toEqual({
    offer_ids: ["sandbox~ref-1", "sandbox~ref-2"],
    message: "Options",
    option_markups: [null, 500],
  });
  expect(JSON.stringify(calls[0]!.body)).not.toMatch(/amount_minor|sell|total|price/);
  expect(client.getQueryData(quoteKeys.detail("q-4"))).toEqual(QUOTE);
  expectInvalidated(client, keys);
});

test("sending a quote returns the link once and marks the quote out of date", async () => {
  const sent = { share_url: "/q/tok_abc", token: "tok_abc", expires_at: "2026-10-15T09:00:00Z" };
  const { calls } = mockApi({ "POST /api/v1/quotes/q-4/send": { status: 200, body: sent } });
  const client = createQueryClient({ retry: false });
  const keys = seedWorkspace(client);
  client.setQueryData(quoteKeys.detail("q-4"), QUOTE);
  const observer = new MutationObserver(client, sendQuoteMutation(client));
  expect(await observer.mutate("q-4")).toEqual(sent);
  expect(calls[0]!.body).toBeUndefined();
  expectInvalidated(client, [...keys, quoteKeys.detail("q-4")]);
  expect(shareUrl(sent, "https://app.example")).toBe("https://app.example/q/tok_abc");
});

test("an agent can mark a sent quote accepted, declined or expired", async () => {
  const { calls } = mockApi({
    "POST /api/v1/quotes/q-4/status": { status: 200, body: { ...QUOTE, status: "accepted" } },
  });
  const client = createQueryClient({ retry: false });
  const keys = seedWorkspace(client);
  const observer = new MutationObserver(client, decideQuoteMutation(client));
  await observer.mutate({ id: "q-4", status: "accepted" });
  expect(calls[0]!.body).toEqual({ status: "accepted" });
  expect(client.getQueryData<QuoteDetail>(quoteKeys.detail("q-4"))?.status).toBe("accepted");
  expectInvalidated(client, keys);
});

// --- clients --------------------------------------------------------------------------------------

test("clients are listed by search and tag and carry their stats and trips", async () => {
  const { calls } = mockApi({
    "GET /api/v1/clients": { status: 200, body: { items: [CLIENT], total: 1 } },
    "GET /api/v1/clients/c-priya": { status: 200, body: CLIENT },
    "GET /api/v1/clients/c-priya/activity": { status: 200, body: { items: [] } },
  });
  const client = createQueryClient({ retry: false });
  const list = await client.fetchQuery(clientsQueryOptions({ q: "pri", tag: "vip", offset: 50 }));
  expect(Object.fromEntries(calls[0]!.search)).toEqual({ q: "pri", tag: "vip", offset: "50" });
  expect(list.items[0]?.next_trip?.destination).toBe("GOI");
  expect((await client.fetchQuery(clientQueryOptions("c-priya"))).won_value_minor).toBe(1_250_000);
  expect((await client.fetchQuery(clientActivityQueryOptions("c-priya"))).items).toEqual([]);
});

test("client create, edit and delete refresh the workspace", async () => {
  const { calls } = mockApi({
    "POST /api/v1/clients": { status: 201, body: CLIENT },
    "PATCH /api/v1/clients/c-priya": { status: 200, body: { ...CLIENT, phone: "+91 98100 00000" } },
    "DELETE /api/v1/clients/c-priya": { status: 204 },
  });
  const client = createQueryClient({ retry: false });

  let keys = seedWorkspace(client);
  await new MutationObserver(client, createClientMutation(client)).mutate({ name: "Priya Sharma", tags: ["vip"] });
  expect(calls[0]!.body).toEqual({ name: "Priya Sharma", tags: ["vip"] });
  expect(client.getQueryData(clientKeys.detail("c-priya"))).toEqual(CLIENT);
  expectInvalidated(client, keys);

  keys = seedWorkspace(client);
  await new MutationObserver(client, updateClientMutation(client)).mutate({
    id: "c-priya",
    changes: { phone: "+91 98100 00000", email: null },
  });
  expect(calls[1]!.body).toEqual({ phone: "+91 98100 00000", email: null });
  expectInvalidated(client, keys);

  keys = seedWorkspace(client);
  await new MutationObserver(client, deleteClientMutation(client)).mutate("c-priya");
  expect(calls[2]!.method).toBe("DELETE");
  expect(client.getQueryData(clientKeys.detail("c-priya"))).toBeUndefined();
  expectInvalidated(client, keys);
});

test("the delete conflict keeps the server's message", async () => {
  mockApi({
    "DELETE /api/v1/clients/c-priya": {
      status: 409,
      body: { detail: "This client has quotes, so it can't be deleted." },
    },
  });
  await expect(clientsApi.remove("c-priya")).rejects.toThrow("This client has quotes, so it can't be deleted.");
});

// --- route intel ----------------------------------------------------------------------------------

test("route intel is read for a complete route and cabin", async () => {
  const { calls } = mockApi({ "GET /api/v1/routes/intel": { status: 200, body: INTEL } });
  const client = createQueryClient({ retry: false });
  const intel = await client.fetchQuery(routeIntelQueryOptions({ origin: "DEL", destination: "BOM", cabin: "business" }));
  expect(intel.family).toBe("market");
  expect(Object.fromEntries(calls[0]!.search)).toEqual({ origin: "DEL", destination: "BOM", cabin: "business" });
  expect(routeIntelQueryOptions({ origin: "del", destination: "bom" }).queryKey).toEqual(
    routeIntelKeys.intel("DEL", "BOM", "economy"),
  );
});

test("route intel stays idle until both ends are chosen and differ", () => {
  const { fetchMock } = mockApi({});
  const client = createQueryClient({ retry: false });
  for (const route of [
    { origin: null, destination: "BOM" },
    { origin: "DEL", destination: null },
    { origin: "DEL", destination: "del" },
  ]) {
    const observer = new QueryObserver(client, routeIntelQueryOptions(route));
    const stop = observer.subscribe(() => undefined);
    expect(observer.getCurrentResult().fetchStatus).toBe("idle");
    stop();
  }
  expect(fetchMock).not.toHaveBeenCalled();
});

// --- public quote ---------------------------------------------------------------------------------

test("the public quote is read by its token, escaped in the path", async () => {
  const { calls } = mockApi({ "GET /api/v1/public/quotes/tok%2Fabc": { status: 200, body: PUBLIC_QUOTE } });
  const client = createQueryClient({ retry: false });
  const quote = await client.fetchQuery(publicQuoteQueryOptions("tok/abc"));
  expect(quote.options[0]?.price_label).toBe(INDICATIVE_PRICE_LABEL);
  expect(LIVE_PRICE_LABEL).toBe("Live fare at the time of quoting");
  expect(calls[0]!.path).toBe("/api/v1/public/quotes/tok%2Fabc");
});

test("a public decision posts the choice, stores the new state and never signs anyone out", async () => {
  const accepted: PublicQuote = { ...PUBLIC_QUOTE, status: "accepted", decided_at: "2026-10-03T10:00:00Z", accepted_option: 0 };
  const { calls } = mockApi({ "POST /api/v1/public/quotes/tok_abc/decision": { status: 200, body: accepted } });
  const client = createQueryClient({ retry: false });
  const observer = new MutationObserver(client, publicQuoteDecisionMutation(client, "tok_abc"));
  await observer.mutate({ decision: "accept", option_index: 0 });
  expect(calls[0]!.body).toEqual({ decision: "accept", option_index: 0 });
  expect(client.getQueryData(publicQuoteKeys.quote("tok_abc"))).toEqual(accepted);
  expect(publicQuoteDecisionMutation(client, "tok_abc").meta?.skipAuthRedirect).toBe(true);
  await publicQuotesApi.decide("tok_abc", { decision: "decline" });
  expect(calls[1]!.body).toEqual({ decision: "decline" });
});

// --- session --------------------------------------------------------------------------------------

test("records, timelines and route intel do not outlive the session", () => {
  const client = createQueryClient({ retry: false });
  client.setQueryData(qk.me, null);
  client.setQueryData(enquiryKeys.detail("e-5"), ENQUIRY);
  client.setQueryData(enquiryKeys.activity("e-5"), TIMELINE);
  client.setQueryData(quoteKeys.list({}), { items: [QUOTE], total: 1 });
  client.setQueryData(clientKeys.detail("c-priya"), CLIENT);
  client.setQueryData(routeIntelKeys.intel("DEL", "BOM", "economy"), INTEL);
  resetSessionState(client);
  expect(client.getQueryCache().getAll().map((query) => query.queryKey)).toEqual([qk.me]);
});
