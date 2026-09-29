import type { QueryClient } from "@tanstack/react-query";
import { qk } from "../api/queries";
import { routeStore } from "../features/route/routeStore";

/**
 * Forget everything that belonged to the previous session — another agency's roster, invitations,
 * cached lookups and the route being scanned — so the next user never sees it, even for a moment.
 * `me` is kept: the caller sets it (null on sign-out or expiry, the new user on sign-in).
 * Removing a query also cancels its in-flight request, so a late response can't repopulate it.
 */
export function resetSessionState(queryClient: QueryClient): void {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== qk.me[0] });
  routeStore.reset();
}
