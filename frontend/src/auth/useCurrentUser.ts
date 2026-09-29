import { useQuery } from "@tanstack/react-query";
import { meQueryOptions } from "../api/queries";
import type { Me } from "../api/types";

/** The signed-in user, or null (briefly, while signing out). The router guard ensures it's loaded. */
export function useCurrentUser(): Me | null {
  return useQuery(meQueryOptions).data ?? null;
}
