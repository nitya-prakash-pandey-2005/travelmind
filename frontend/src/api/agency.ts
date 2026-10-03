import { mutationOptions, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { dashboardKeys } from "./dashboard";
import { qk } from "./queries";
import { routeIntelKeys } from "./routeIntel";
import type { Me } from "./types";
import { agencyQueryOptions, workspaceKeys, type AgencyProfile } from "./workspace";

/**
 * The agency profile (GET/PATCH /api/v1/agency), field for field with backend/src/travelmind/workspace/agency.py.
 * Reading it is `agencyQueryOptions` in ./workspace; this module changes it.
 */

/** What Settings may change. Owners and admins only; a demo workspace gets 403 with the demo note. */
export type AgencyUpdate = {
  /** 2–200 characters, no control characters (trimmed by the server). */
  name?: string;
  /** An IANA time zone the server knows. */
  timezone?: string;
  /** "#rrggbb", stored lower case. */
  brand_color?: string;
};

/** The server's limits on an agency name (after trimming). */
export const AGENCY_NAME_MIN = 2;
export const AGENCY_NAME_MAX = 200;
/** A brand colour as the server stores it. */
export const BRAND_COLOR = /^#[0-9a-f]{6}$/;

export const agencyApi = {
  update: (changes: AgencyUpdate) => apiFetch<AgencyProfile>("/api/v1/agency", { method: "PATCH", body: changes }),
};

/**
 * A saved profile reaches everything that shows it: the top bar and accents (the session's agency), the
 * Command Center and setup checklist, route intel (its days follow the agency's time zone) and any client
 * quote page already open in this session (it carries the brand colour).
 */
function saved(client: QueryClient, profile: AgencyProfile): void {
  client.setQueryData(agencyQueryOptions.queryKey, profile);
  client.setQueryData<Me | null>(qk.me, (me) =>
    me
      ? {
          ...me,
          agency: {
            ...me.agency,
            name: profile.name,
            timezone: profile.timezone,
            brand_color: profile.brand_color,
          },
        }
      : me,
  );
  for (const queryKey of [workspaceKeys.agency, qk.me, dashboardKeys.all, workspaceKeys.onboarding, routeIntelKeys.all, ["public-quote"]]) {
    void client.invalidateQueries({ queryKey });
  }
}

export function updateAgencyMutation(client: QueryClient) {
  return mutationOptions({
    mutationFn: (changes: AgencyUpdate) => agencyApi.update(changes),
    onSuccess: (profile) => saved(client, profile),
  });
}

export const useUpdateAgency = () => useMutation(updateAgencyMutation(useQueryClient()));
