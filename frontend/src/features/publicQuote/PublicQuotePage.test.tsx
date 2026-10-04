import { QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import {
  INDICATIVE_PRICE_LABEL,
  LIVE_PRICE_LABEL,
  type PublicOption,
  type PublicQuote,
} from "../../api/publicQuotes";
import { createQueryClient } from "../../api/queryClient";
import { mockApi, type MockHandler } from "../../test/mockApi";
import { renderWithClient } from "../../test/renderWithClient";
import indexHtml from "../../../index.html?raw";
import { PublicQuotePage, PublicQuoteView } from "./PublicQuotePage";

const TOKEN = "tok_8sV2xQ";
const GET = `GET /api/v1/public/quotes/${TOKEN}`;
const POST = `POST /api/v1/public/quotes/${TOKEN}/decision`;

const INDIGO: PublicOption = {
  index: 0,
  carrier_code: "6E",
  carrier_name: "IndiGo",
  cabin: "economy",
  slices: [
    {
      origin: "DEL",
      destination: "DXB",
      departing_at: "2026-11-20T06:10:00",
      arriving_at: "2026-11-20T08:25:00",
      duration_minutes: 225,
      stops: 0,
      segments: [
        {
          marketing_carrier: "6E",
          flight_number: "1461",
          origin: "DEL",
          destination: "DXB",
          departing_at: "2026-11-20T06:10:00",
          arriving_at: "2026-11-20T08:25:00",
        },
      ],
    },
    {
      origin: "DXB",
      destination: "DEL",
      departing_at: "2026-11-27T22:40:00",
      arriving_at: "2026-11-28T03:35:00",
      duration_minutes: 205,
      stops: 0,
      segments: [
        {
          marketing_carrier: "6E",
          flight_number: "1462",
          origin: "DXB",
          destination: "DEL",
          departing_at: "2026-11-27T22:40:00",
          arriving_at: "2026-11-28T03:35:00",
        },
      ],
    },
  ],
  baggage: { checked: 1, carry_on: 1 },
  refundable: false,
  changeable: true,
  co2_kg_per_passenger: 412,
  price_label: INDICATIVE_PRICE_LABEL,
  sell: { amount_minor: 6_840_000, currency: "INR" },
  per_traveller: { amount_minor: 3_420_000, currency: "INR" },
};

const EMIRATES: PublicOption = {
  ...INDIGO,
  index: 1,
  carrier_code: "EK",
  carrier_name: "Emirates",
  slices: [
    {
      origin: "DEL",
      destination: "DXB",
      departing_at: "2026-11-20T04:15:00",
      arriving_at: "2026-11-20T10:05:00",
      duration_minutes: 380,
      stops: 1,
      segments: [
        {
          marketing_carrier: "EK",
          flight_number: "511",
          origin: "DEL",
          destination: "BOM",
          departing_at: "2026-11-20T04:15:00",
          arriving_at: "2026-11-20T06:20:00",
        },
        {
          marketing_carrier: "EK",
          flight_number: "501",
          origin: "BOM",
          destination: "DXB",
          departing_at: "2026-11-20T08:10:00",
          arriving_at: "2026-11-20T10:05:00",
        },
      ],
    },
  ],
  baggage: { checked: 2, carry_on: 1 },
  refundable: true,
  changeable: true,
  co2_kg_per_passenger: null,
  price_label: LIVE_PRICE_LABEL,
  sell: { amount_minor: 9_120_000, currency: "INR" },
  per_traveller: null,
};

/** The page-level live notice that holds a refused decision's reason. */
async function findRefusal(message: string) {
  const text = await screen.findByText(message);
  const region = text.closest('[role="status"]');
  expect(region).not.toBeNull();
  return region as HTMLElement;
}

const QUOTE: PublicQuote = {
  number: "Q-0004",
  status: "viewed",
  agency: { name: "Orbit Travel Co.", brand_color: "#0F766E", timezone: "Asia/Kolkata" },
  client_first_name: "Priya",
  message: "Two good ways to get you to Dubai for the conference.\nThe Emirates fare includes two checked bags.",
  options: [INDIGO, EMIRATES],
  currency: "INR",
  expires_at: "2026-10-14T12:00:00Z",
  decided_at: null,
  accepted_option: null,
};

function renderPage(quote: MockHandler = { status: 200, body: QUOTE }, extra: Record<string, MockHandler> = {}) {
  const api = mockApi({ [GET]: quote, ...extra });
  return { ...renderWithClient(<PublicQuoteView token={TOKEN} />), api };
}

test("shows the agency's quote: greeting, message, options with their price labels and validity", async () => {
  renderPage();
  expect(await screen.findByRole("heading", { level: 1, name: "Hello Priya," })).toBeInTheDocument();
  expect(screen.getAllByText("Orbit Travel Co.").length).toBeGreaterThan(0);
  expect(screen.getByText("Q-0004")).toBeInTheDocument();
  expect(screen.getByText(/Two good ways to get you to Dubai/)).toBeInTheDocument();
  expect(screen.getByText("Valid until 14 Oct 2026")).toBeInTheDocument();
  await waitFor(() => expect(document.title).toBe("Quote Q-0004 · Orbit Travel Co."));

  const first = screen.getByRole("article", { name: /Option 1/ });
  expect(within(first).getByText("IndiGo")).toBeInTheDocument();
  expect(within(first).getByText(INDICATIVE_PRICE_LABEL)).toBeInTheDocument();
  expect(within(first).getByText("₹68,400")).toBeInTheDocument();
  expect(within(first).getByText("₹34,200").parentElement).toHaveTextContent("₹34,200 per traveller");
  expect(within(first).getByText("06:10")).toBeInTheDocument();
  expect(within(first).getAllByText("Nonstop").length).toBe(2);
  expect(within(first).getByText("412 kg CO₂ per passenger")).toBeInTheDocument();
  expect(within(first).getByText("Non-refundable")).toBeInTheDocument();
  expect(within(first).getByText("1 checked bag · 1 cabin bag")).toBeInTheDocument();

  const second = screen.getByRole("article", { name: /Option 2/ });
  expect(within(second).getByText(LIVE_PRICE_LABEL)).toBeInTheDocument();
  expect(within(second).getByText("1 stop · BOM")).toBeInTheDocument();
  expect(within(second).queryByText(/per traveller/)).not.toBeInTheDocument();
});

test("never shows internal or booking wording", async () => {
  renderPage();
  await screen.findByRole("heading", { level: 1 });
  const page = document.body.cloneNode(true) as HTMLElement;
  page.querySelectorAll("style").forEach((style) => style.remove());
  const text = page.textContent ?? "";
  for (const word of [/markup/i, /supplier/i, /bookable/i, /\bSANDBOX\b/, /\bCACHED\b/, /\bLIVE\b/, /cost/i, /margin/i]) {
    expect(text).not.toMatch(word);
  }
});

test("accepting asks which option, confirms, posts the choice and thanks the client", async () => {
  const { user, api } = renderPage(undefined, {
    [POST]: { status: 200, body: { ...QUOTE, status: "accepted", decided_at: "2026-10-03T10:00:00Z", accepted_option: 1 } },
  });
  await user.click(await screen.findByRole("button", { name: "Accept option 2" }));
  const dialog = screen.getByRole("dialog", { name: "Accept option 2?" });
  expect(within(dialog).getByText("Emirates")).toBeInTheDocument();
  expect(within(dialog).getByText("₹91,200")).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Confirm acceptance" }));

  expect(await screen.findByRole("heading", { name: "Thanks — Orbit Travel Co. has been notified." })).toBeInTheDocument();
  expect(api.calls.find((call) => call.method === "POST")?.body).toEqual({ decision: "accept", option_index: 1 });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Accept option/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Decline this quote" })).not.toBeInTheDocument();
  expect(screen.getByText(/You accepted option 2/)).toBeInTheDocument();
});

test("cancelling the confirmation posts nothing", async () => {
  const { user, api } = renderPage();
  await user.click(await screen.findByRole("button", { name: "Accept option 1" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.calls.some((call) => call.method === "POST")).toBe(false);
});

test("declining confirms, posts the decline and thanks the client", async () => {
  const { user, api } = renderPage(undefined, {
    [POST]: { status: 200, body: { ...QUOTE, status: "declined", decided_at: "2026-10-03T10:00:00Z" } },
  });
  await user.click(await screen.findByRole("button", { name: "Decline this quote" }));
  const dialog = screen.getByRole("dialog", { name: "Decline this quote?" });
  await user.click(within(dialog).getByRole("button", { name: "Decline quote" }));

  expect(await screen.findByRole("heading", { name: "Thanks — Orbit Travel Co. has been notified." })).toBeInTheDocument();
  expect(api.calls.find((call) => call.method === "POST")?.body).toEqual({ decision: "decline" });
  expect(screen.getByText(/You declined this quote/)).toBeInTheDocument();
});

test("a decision that is refused keeps the dialog open with the reason", async () => {
  const { user } = renderPage(undefined, {
    [POST]: { status: 429, body: { detail: "Too many requests. Please try again in a minute." } },
  });
  await user.click(await screen.findByRole("button", { name: "Accept option 1" }));
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Confirm acceptance" }));
  expect(await within(dialog).findByText("Too many requests. Please try again in a minute.")).toBeInTheDocument();
});

test("a quote decided elsewhere meanwhile reloads and shows its current state", async () => {
  let reads = 0;
  const { user } = renderPage(
    () => {
      reads += 1;
      return { status: 200, body: reads === 1 ? QUOTE : { ...QUOTE, status: "declined", decided_at: "2026-10-03T09:00:00Z" } };
    },
    { [POST]: { status: 409, body: { detail: "This quote has already been declined." } } },
  );
  await user.click(await screen.findByRole("button", { name: "Accept option 1" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm acceptance" }));
  expect(await screen.findByRole("heading", { name: "This quote was declined on 3 Oct 2026." })).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Accept option/ })).not.toBeInTheDocument();
  // The reason gave way to the fresh state.
  expect(screen.queryByText("This quote has already been declined.")).not.toBeInTheDocument();
});

test("a refused decision keeps its reason on the page, with the buttons off, while the quote reloads", async () => {
  let reads = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { user } = renderPage(
    async () => {
      reads += 1;
      if (reads === 1) return { status: 200, body: QUOTE };
      await held;
      return { status: 429, body: { detail: "Too many requests. Please try again in a minute." } };
    },
    { [POST]: { status: 409, body: { detail: "This quote has already been declined." } } },
  );
  await user.click(await screen.findByRole("button", { name: "Accept option 1" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm acceptance" }));

  await findRefusal("This quote has already been declined.");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Accept option 1" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Decline this quote" })).toBeDisabled();

  // The reload is refused too: the stale quote stays, and so does the reason.
  release();
  await waitFor(() => expect(screen.getByRole("button", { name: "Accept option 1" })).toBeEnabled());
  await findRefusal("This quote has already been declined.");
});

test("an expired quote's refusal is kept on the page when the reload fails", async () => {
  let reads = 0;
  const { user } = renderPage(
    () => {
      reads += 1;
      return reads === 1 ? { status: 200, body: QUOTE } : { status: 503, body: { detail: "Service unavailable" } };
    },
    { [POST]: { status: 410, body: { detail: "This quote has expired. Ask your travel agent for a fresh one." } } },
  );
  await user.click(await screen.findByRole("button", { name: "Decline this quote" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Decline quote" }));
  await waitFor(() => expect(reads).toBe(2));
  await findRefusal("This quote has expired. Ask your travel agent for a fresh one.");
});

test("confirming twice in a row sends one decision", async () => {
  const { api } = renderPage(undefined, {
    [POST]: { status: 200, body: { ...QUOTE, status: "declined", decided_at: "2026-10-03T10:00:00Z" } },
  });
  fireEvent.click(await screen.findByRole("button", { name: "Decline this quote" }));
  const confirmButton = within(screen.getByRole("dialog")).getByRole("button", { name: "Decline quote" });
  fireEvent.click(confirmButton);
  fireEvent.click(confirmButton);
  expect(await screen.findByRole("heading", { name: "Thanks — Orbit Travel Co. has been notified." })).toBeInTheDocument();
  expect(api.calls.filter((call) => call.method === "POST")).toHaveLength(1);
});

test("an expired quote says so and offers no decision", async () => {
  renderPage({ status: 200, body: { ...QUOTE, status: "expired", decided_at: null } });
  expect(await screen.findByRole("heading", { name: "This quote has expired." })).toBeInTheDocument();
  expect(screen.getByText(/Ask your travel agent for a fresh one/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Accept option/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Decline this quote" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Valid until/)).not.toBeInTheDocument();
});

test("an accepted quote shows which option was chosen", async () => {
  renderPage({
    status: 200,
    body: { ...QUOTE, status: "accepted", decided_at: "2026-10-02T09:00:00Z", accepted_option: 0 },
  });
  // Neutral: the agency may have recorded the decision for the client.
  expect(await screen.findByRole("heading", { name: "Option 1 was accepted on 2 Oct 2026." })).toBeInTheDocument();
  expect(screen.queryByText(/You accepted/)).not.toBeInTheDocument();
  expect(within(screen.getByRole("article", { name: /Option 1/ })).getByText("Accepted")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Accept option/ })).not.toBeInTheDocument();
});

test("a declined quote says when, without saying who", async () => {
  renderPage({ status: 200, body: { ...QUOTE, status: "declined", decided_at: "2026-10-02T09:00:00Z" } });
  expect(await screen.findByRole("heading", { name: "This quote was declined on 2 Oct 2026." })).toBeInTheDocument();
  expect(screen.queryByText(/You declined/)).not.toBeInTheDocument();
});

test("a single traveller's price is not called a price for all travellers", async () => {
  renderPage();
  const second = await screen.findByRole("article", { name: /Option 2/ });
  expect(within(second).getByText("₹91,200")).toBeInTheDocument();
  expect(screen.queryByText(/for all travellers/i)).not.toBeInTheDocument();
});

test("any price label other than the live one reads as indicative", async () => {
  const odd = { ...EMIRATES, price_label: "Sandbox fare" } as unknown as PublicOption;
  renderPage({ status: 200, body: { ...QUOTE, options: [INDIGO, odd] } });
  const second = await screen.findByRole("article", { name: /Option 2/ });
  expect(within(second).getByText(INDICATIVE_PRICE_LABEL)).toBeInTheDocument();
  expect(screen.queryByText("Sandbox fare")).not.toBeInTheDocument();
});

test("the page asks not to be indexed and sends no referrer", async () => {
  renderPage();
  await screen.findByRole("heading", { level: 1 });
  expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  expect(document.head.querySelector('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
});

test("the static page a link preview reads names no console or price-source wording", () => {
  const doc = new DOMParser().parseFromString(indexHtml, "text/html");
  expect(doc.title).toBe("TravelMind");
  const description = doc.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
  expect(description).toBe("Travel quotes and trip planning by TravelMind.");
  for (const word of [/console/i, /sandbox/i, /cached/i, /\blive\b/i, /supplier/i]) {
    expect(`${doc.title} ${description}`).not.toMatch(word);
  }
});

test("an invalid link says so plainly", async () => {
  renderPage({ status: 404, body: { detail: "This quote link isn't valid. Ask your travel agent for a new one." } });
  expect(await screen.findByRole("heading", { name: "This quote link isn't valid" })).toBeInTheDocument();
  expect(screen.getByText("Ask your travel agent for a new one.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
});

test("too many requests offers a retry", async () => {
  let reads = 0;
  const { user } = renderPage(() => {
    reads += 1;
    return reads === 1
      ? { status: 429, body: { detail: "Too many requests. Please try again in a minute." } }
      : { status: 200, body: QUOTE };
  });
  expect(await screen.findByRole("heading", { name: "Too many requests" })).toBeInTheDocument();
  expect(screen.getByText("Too many requests. Please try again in a minute.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { level: 1, name: "Hello Priya," })).toBeInTheDocument();
});

test("the expiry date is the agency's local date, not the viewer's or UTC", async () => {
  // 20:00 UTC on 14 Oct is already 15 Oct in Kolkata.
  renderPage({ status: 200, body: { ...QUOTE, expires_at: "2026-10-14T20:00:00Z" } });
  expect(await screen.findByText("Valid until 15 Oct 2026")).toBeInTheDocument();
});

test("a quote for a company greets without a name", async () => {
  renderPage({ status: 200, body: { ...QUOTE, client_first_name: null } });
  expect(await screen.findByRole("heading", { level: 1, name: "Hello," })).toBeInTheDocument();
});

test("the route page reads the token from the link", async () => {
  const api = mockApi({ [GET]: { status: 200, body: QUOTE } });
  const rootRoute = createRootRoute();
  const quoteRoute = createRoute({ getParentRoute: () => rootRoute, path: "/q/$token", component: PublicQuotePage });
  const router = createRouter({
    routeTree: rootRoute.addChildren([quoteRoute]),
    history: createMemoryHistory({ initialEntries: [`/q/${TOKEN}`] }),
  });
  const queryClient = createQueryClient({ retry: false });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole("heading", { level: 1, name: "Hello Priya," })).toBeInTheDocument();
  expect(api.calls[0]?.path).toBe(`/api/v1/public/quotes/${TOKEN}`);
  // No app shell or app navigation on the client's page.
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
});
