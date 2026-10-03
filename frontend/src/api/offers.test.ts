import { QueryObserver } from "@tanstack/react-query";
import { expect, test } from "vitest";
import { resetSessionState } from "../auth/resetSessionState";
import { dashboardKeys } from "./dashboard";
import { mockApi } from "../test/mockApi";
import { makeOffer, searchResponse } from "../test/offerFixtures";
import { offersApi, type FlightSearchRequest, type HotelSearchRequest, type HotelSearchResponse } from "./offers";
import {
  flightSearchQueryOptions,
  hotelSearchQueryOptions,
  qk,
  suppliersQueryOptions,
} from "./queries";
import { createQueryClient } from "./queryClient";
import { routeIntelKeys } from "./routeIntel";
import { workspaceKeys } from "./workspace";

const FLIGHTS: FlightSearchRequest = {
  origin: "DEL",
  destination: "BOM",
  departure_date: "2026-11-20",
  return_date: null,
  adults: 1,
  children_ages: [],
  cabin: "economy",
  max_connections: 1,
};

const HOTELS: HotelSearchRequest = {
  destination: "BOM",
  checkin: "2026-11-20",
  checkout: "2026-11-22",
  rooms: [{ adults: 2, children_ages: [] }],
};

const NO_HOTELS: HotelSearchResponse = { display_currency: "INR", fx_as_of: null, nights: 2, sources: [], offers: [] };

test("flight search posts the trip", async () => {
  const { calls } = mockApi({ "POST /api/v1/flights/search": { status: 200, body: searchResponse() } });
  const request = {
    origin: "DEL",
    destination: "BOM",
    departure_date: "2026-11-20",
    return_date: null,
    adults: 1,
    children_ages: [],
    cabin: "economy" as const,
    max_connections: 1,
  };
  const result = await offersApi.searchFlights(request);
  expect(result.offers[0]?.id).toBe("sandbox~ref-1");
  expect(calls[0]?.body).toEqual(request);
});

test("re-pricing addresses the offer by id", async () => {
  const offer = makeOffer({ id: "duffel~off_123" });
  const { calls } = mockApi({
    "POST /api/v1/flights/offers/duffel~off_123/price": {
      status: 200,
      body: { offer, price_changed: false, previous_total: offer.total },
    },
  });
  const result = await offersApi.reprice(offer.id);
  expect(result.price_changed).toBe(false);
  expect(calls[0]?.method).toBe("POST");
});

test("hotel search posts the stay and suppliers are read with GET", async () => {
  const { calls } = mockApi({
    "POST /api/v1/hotels/search": {
      status: 200,
      body: NO_HOTELS,
    },
    "GET /api/v1/suppliers": { status: 200, body: [] },
  });
  expect((await offersApi.searchHotels(HOTELS)).nights).toBe(2);
  expect(await offersApi.suppliers()).toEqual([]);
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
    "POST /api/v1/hotels/search",
    "GET /api/v1/suppliers",
  ]);
  expect(calls[0]?.body).toEqual(HOTELS);
});

test("searches stay idle until there is a request", () => {
  const { fetchMock } = mockApi({});
  const client = createQueryClient({ retry: false });
  const flights = new QueryObserver(client, flightSearchQueryOptions(null));
  const hotels = new QueryObserver(client, hotelSearchQueryOptions(null));
  const unsubscribe = [flights.subscribe(() => undefined), hotels.subscribe(() => undefined)];
  expect(flights.getCurrentResult().fetchStatus).toBe("idle");
  expect(hotels.getCurrentResult().fetchStatus).toBe("idle");
  unsubscribe.forEach((stop) => stop());
  expect(fetchMock).not.toHaveBeenCalled();
});

test("a completed search marks the Command Center figures, the setup checklist and route intel out of date", async () => {
  mockApi({
    "POST /api/v1/flights/search": { status: 200, body: searchResponse() },
    "POST /api/v1/hotels/search": { status: 200, body: NO_HOTELS },
  });
  const client = createQueryClient({ retry: false });
  const summary = dashboardKeys.summary("30d");
  const seed = () => {
    client.setQueryData(summary, { kpis: [] });
    client.setQueryData(workspaceKeys.onboarding, { items: [], completed: 0, total: 6 });
    client.setQueryData(routeIntelKeys.intel("DEL", "BOM", "economy"), { daily: [] });
  };

  seed();
  await client.fetchQuery(flightSearchQueryOptions(FLIGHTS));
  expect(client.getQueryState(summary)?.isInvalidated).toBe(true);
  expect(client.getQueryState(workspaceKeys.onboarding)?.isInvalidated).toBe(true);
  expect(client.getQueryState(routeIntelKeys.intel("DEL", "BOM", "economy"))?.isInvalidated).toBe(true);

  seed();
  await client.fetchQuery(hotelSearchQueryOptions(HOTELS));
  expect(client.getQueryState(summary)?.isInvalidated).toBe(true);
  expect(client.getQueryState(workspaceKeys.onboarding)?.isInvalidated).toBe(true);
});

test("a failed search is not retried, even by a retrying client", async () => {
  const { calls } = mockApi({
    "POST /api/v1/flights/search": { status: 503, body: { detail: "Suppliers are unavailable." } },
    "POST /api/v1/hotels/search": { status: 503, body: { detail: "Suppliers are unavailable." } },
  });
  const client = createQueryClient();
  await expect(client.fetchQuery(flightSearchQueryOptions(FLIGHTS))).rejects.toThrow("Suppliers are unavailable.");
  await expect(client.fetchQuery(hotelSearchQueryOptions(HOTELS))).rejects.toThrow("Suppliers are unavailable.");
  expect(calls).toHaveLength(2);
  expect(flightSearchQueryOptions(FLIGHTS).staleTime).toBe(5 * 60_000);
  expect(hotelSearchQueryOptions(HOTELS).staleTime).toBe(5 * 60_000);
});

test("search results and supplier status do not outlive the session", () => {
  const client = createQueryClient({ retry: false });
  client.setQueryData(qk.me, null);
  client.setQueryData(qk.flights(FLIGHTS), searchResponse());
  client.setQueryData(qk.hotels(HOTELS), NO_HOTELS);
  client.setQueryData(suppliersQueryOptions.queryKey, []);

  resetSessionState(client);

  expect(client.getQueryCache().getAll().map((query) => query.queryKey)).toEqual([qk.me]);
});
