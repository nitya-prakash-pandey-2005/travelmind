import { queryOptions, skipToken } from "@tanstack/react-query";
import { authApi } from "./auth";
import { checkHealth } from "./health";
import { offersApi, type FlightSearchRequest, type HotelSearchRequest } from "./offers";
import { referenceApi } from "./reference";
import { teamApi } from "./team";

export const qk = {
  me: ["me"] as const,
  team: ["team"] as const,
  invitations: ["invitations"] as const,
  health: ["health"] as const,
  airports: (term: string) => ["airports", term.toLowerCase()] as const,
  flights: (request: FlightSearchRequest | null) => ["flights", request] as const,
  hotels: (request: HotelSearchRequest | null) => ["hotels", request] as const,
  suppliers: ["suppliers"] as const,
};

export const meQueryOptions = queryOptions({
  queryKey: qk.me,
  queryFn: () => authApi.me(),
  staleTime: 5 * 60_000,
});

export const teamQueryOptions = queryOptions({
  queryKey: qk.team,
  queryFn: () => teamApi.listTeam(),
});

export const invitationsQueryOptions = queryOptions({
  queryKey: qk.invitations,
  queryFn: () => teamApi.listInvitations(),
});

export const healthQueryOptions = queryOptions({
  queryKey: qk.health,
  queryFn: ({ signal }) => checkHealth(signal),
  refetchInterval: 30_000,
  retry: false,
});

export function airportSearchQueryOptions(term: string) {
  return queryOptions({
    queryKey: qk.airports(term),
    queryFn: ({ signal }) => referenceApi.searchAirports(term, 8, signal),
    staleTime: 10 * 60_000,
  });
}

/** Searches are explicit: idle until a request exists, never retried (a retry would burn rate limit). */
export function flightSearchQueryOptions(request: FlightSearchRequest | null) {
  return queryOptions({
    queryKey: qk.flights(request),
    queryFn: request ? ({ signal }) => offersApi.searchFlights(request, signal) : skipToken,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function hotelSearchQueryOptions(request: HotelSearchRequest | null) {
  return queryOptions({
    queryKey: qk.hotels(request),
    queryFn: request ? ({ signal }) => offersApi.searchHotels(request, signal) : skipToken,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export const suppliersQueryOptions = queryOptions({
  queryKey: qk.suppliers,
  queryFn: ({ signal }) => offersApi.suppliers(signal),
  staleTime: 60_000,
});
