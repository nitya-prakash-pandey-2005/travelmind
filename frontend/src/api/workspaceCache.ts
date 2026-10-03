import type { QueryClient } from "@tanstack/react-query";
import { dashboardKeys } from "./dashboard";
import { workspaceKeys } from "./workspace";

/**
 * Root query keys of the workspace records. Every list, detail and timeline key starts with one of
 * these, so one invalidation refreshes all of them. (The New enquiry dialog's client suggestions live
 * under "clients" too.)
 */
export const RECORD_ROOTS = {
  enquiries: ["enquiries"] as const,
  quotes: ["quotes"] as const,
  clients: ["clients"] as const,
};

/**
 * A change to one record ripples: a quote send moves its enquiry to Quoted, an acceptance wins the
 * enquiry and adds to the client's won value, a new client ticks the setup checklist, and the Command
 * Center counts all of it. So every workspace write marks the dashboard, the checklist, the record
 * search and all record lists, details and timelines out of date; only what is on screen refetches.
 */
export function refreshWorkspace(client: QueryClient): void {
  for (const queryKey of [
    dashboardKeys.all,
    workspaceKeys.onboarding,
    ["search"],
    RECORD_ROOTS.enquiries,
    RECORD_ROOTS.quotes,
    RECORD_ROOTS.clients,
  ]) {
    void client.invalidateQueries({ queryKey });
  }
}

/** "?a=1&b=2" from the defined, non-blank params; "" when there are none. */
export function queryString(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) search.set(key, text);
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

/** A path segment: ids and tokens are escaped so they can never change the path. */
export const segment = (value: string) => encodeURIComponent(value);
