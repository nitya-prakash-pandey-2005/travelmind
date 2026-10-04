import type { ClientOut } from "../../api/clients";
import type { EnquiryOut } from "../../api/enquiries";
import type { QuoteSummary } from "../../api/quotes";
import type { Timeline } from "../../api/timeline";
import { ME_OWNER } from "../../test/fixtures";
import type { MockCall, MockHandler } from "../../test/mockApi";
import { withSession } from "../../test/renderApp";
import { clientOut, commandCenterMocks, enquiryOut } from "../../test/workspaceFixtures";
import { dayFromToday, minutesAgo, quoteSummary } from "../quotes/quoteFixtures";

/** Test data for the client screens, field for field with the backend's client, enquiry and quote schemas. */

export const PRIYA = clientOut("c-priya", "Priya Sharma", {
  email: "priya@example.com",
  phone: "+91 98100 12345",
  company_name: "Sharma Exports",
  home_airport: "DEL",
  notes: "Prefers aisle seats and morning departures.",
  tags: ["vip", "corporate"],
  enquiry_count: 2,
  quote_count: 2,
  won_value_minor: 4_520_000,
  last_trip: { origin: "DEL", destination: "BOM", depart_date: dayFromToday(-20) },
  next_trip: { origin: "DEL", destination: "GOI", depart_date: dayFromToday(18) },
}) as ClientOut;

export const RAHUL = clientOut("c-rahul", "Rahul Mehta", {
  email: "rahul@example.com",
  tags: ["leisure"],
  enquiry_count: 1,
}) as ClientOut;

export const ORBIT = clientOut("c-orbit", "Orbit Logistics", {
  kind: "company",
  email: "travel@orbitlogistics.in",
  tags: ["corporate"],
}) as ClientOut;

export const CLIENTS: ClientOut[] = [PRIYA, RAHUL, ORBIT];

export const PRIYA_ENQUIRIES = [
  enquiryOut({ id: "e-5", number: "E-0005", origin: "DEL", destination: "GOI", status: "quoted", client: { id: PRIYA.id, name: PRIYA.name } }),
  enquiryOut({ id: "e-4", number: "E-0004", origin: "DEL", destination: "BOM", status: "won", client: { id: PRIYA.id, name: PRIYA.name } }),
  // Another client whose name contains Priya's: never listed on her page.
  enquiryOut({ id: "e-9", number: "E-0009", origin: "BOM", destination: "DXB", status: "new", client: { id: "c-priya-2", name: "Priya Sharma Kapoor" } }),
] as unknown as EnquiryOut[];

export const PRIYA_QUOTES: QuoteSummary[] = [
  quoteSummary({
    id: "q-5",
    number: "Q-0005",
    status: "viewed",
    current_version: 2,
    sent_version: 2,
    min_sell_minor: 1_250_000,
    sent_at: minutesAgo(90),
    client: { id: PRIYA.id, name: PRIYA.name, kind: "individual" },
    enquiry: { id: "e-5", number: "E-0005", origin: "DEL", destination: "GOI", depart_date: dayFromToday(18) },
  }),
  quoteSummary({
    id: "q-4",
    number: "Q-0004",
    status: "accepted",
    sent_version: 1,
    // Accepted on a dearer option than the cheapest: the value matches the client's won value.
    min_sell_minor: 4_100_000,
    value_minor: 4_520_000,
    decided_at: minutesAgo(39 * 24 * 60),
    sent_at: minutesAgo(40 * 24 * 60),
    client: { id: PRIYA.id, name: PRIYA.name, kind: "individual" },
    enquiry: { id: "e-4", number: "E-0004", origin: "DEL", destination: "BOM", depart_date: dayFromToday(-20) },
  }),
];

export const PRIYA_TIMELINE: Timeline = {
  items: [
    {
      id: "act-3",
      kind: "quote.viewed",
      summary: "Priya Sharma opened Q-0005",
      occurred_at: minutesAgo(30),
      actor: null,
    },
    {
      id: "act-2",
      kind: "client.updated",
      summary: "Updated client Priya Sharma",
      occurred_at: minutesAgo(600),
      actor: { id: "u-owner", full_name: "Asha Rao" },
    },
    {
      id: "act-1",
      kind: "client.created",
      summary: "Added client Priya Sharma",
      occurred_at: minutesAgo(10 * 24 * 60),
      actor: { id: "u-owner", full_name: "Asha Rao" },
    },
  ],
};

/** GET /api/v1/clients as the server filters it: `q` over name, email and company; `tag` exactly. */
export function listClients(clients: ClientOut[]) {
  return (call: MockCall) => {
    const q = (call.search.get("q") ?? "").trim().toLowerCase();
    const tag = (call.search.get("tag") ?? "").trim().toLowerCase();
    const items = clients.filter(
      (c) =>
        (!q || [c.name, c.email, c.company_name].some((field) => field?.toLowerCase().includes(q))) &&
        (!tag || c.tags.includes(tag)),
    );
    return { status: 200, body: { items, total: items.length } };
  };
}

/**
 * GET /api/v1/enquiries as the server filters it: `client_id` exactly; `q` as an exact number ("E-12")
 * or else over route codes and client name. `limit` caps the page while `total` counts every match.
 */
export function listEnquiries(enquiries: EnquiryOut[]) {
  return (call: MockCall) => {
    const clientId = call.search.get("client_id");
    const q = (call.search.get("q") ?? "").trim().toLowerCase();
    const byNumber = /^e-(\d{1,9})$/.exec(q);
    const matches = enquiries.filter(
      (e) =>
        (!clientId || e.client?.id === clientId) &&
        (!q ||
          (byNumber
            ? Number(e.number.slice(2)) === Number(byNumber[1])
            : [e.origin, e.destination, e.client?.name].some((field) => field?.toLowerCase().includes(q)))),
    );
    const limit = Number(call.search.get("limit") ?? 50);
    return { status: 200, body: { items: matches.slice(0, limit), total: matches.length } };
  };
}

/** The app shell plus every client route, for a busy agency. */
export function clientMocks(extra: Record<string, MockHandler> = {}): Record<string, MockHandler> {
  return withSession(ME_OWNER, {
    ...commandCenterMocks({ populated: true }),
    "GET /api/v1/clients": listClients(CLIENTS),
    "GET /api/v1/clients/c-priya": { status: 200, body: PRIYA },
    "GET /api/v1/clients/c-priya/activity": { status: 200, body: PRIYA_TIMELINE },
    "GET /api/v1/clients/c-rahul": { status: 200, body: RAHUL },
    "GET /api/v1/clients/c-rahul/activity": { status: 200, body: { items: [] } },
    "GET /api/v1/enquiries": listEnquiries(PRIYA_ENQUIRIES),
    "GET /api/v1/quotes": (call: MockCall) => {
      const items = PRIYA_QUOTES.filter((q) => q.client?.id === call.search.get("client_id"));
      return { status: 200, body: { items, total: items.length } };
    },
    ...extra,
  });
}
