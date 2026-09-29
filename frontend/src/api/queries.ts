import { queryOptions } from "@tanstack/react-query";
import { authApi } from "./auth";
import { checkHealth } from "./health";
import { referenceApi } from "./reference";
import { teamApi } from "./team";

export const qk = {
  me: ["me"] as const,
  team: ["team"] as const,
  invitations: ["invitations"] as const,
  health: ["health"] as const,
  airports: (term: string) => ["airports", term.toLowerCase()] as const,
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
