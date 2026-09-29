import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { airportSearchQueryOptions } from "../../api/queries";
import { useDebouncedValue } from "../../lib/useDebouncedValue";

export const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 200;

/**
 * Debounced airport lookup. Queries are keyed by the settled term; `isStale` is true while the
 * shown results belong to an earlier term (debounce pending or previous data held during a fetch),
 * so callers must not let users pick from them.
 */
export function useAirportSearch(term: string) {
  const live = term.trim();
  const settled = useDebouncedValue(live, DEBOUNCE_MS);
  const queryEnabled = settled.length >= MIN_QUERY_LENGTH;
  const query = useQuery({
    ...airportSearchQueryOptions(settled),
    enabled: queryEnabled,
    placeholderData: keepPreviousData,
  });
  // For the UI, the live term must also be long enough, so dropping below the minimum closes the list at once.
  const enabled = queryEnabled && live.length >= MIN_QUERY_LENGTH;
  return {
    results: enabled ? (query.data ?? []) : [],
    enabled,
    isSearching: enabled && query.isFetching,
    isStale: live !== settled || query.isPlaceholderData,
    error: query.error,
  };
}
