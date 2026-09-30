import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { MIN_SEARCH_LENGTH, recordSearchQueryOptions, type SearchResponse } from "../../api/workspace";
import { useDebouncedValue } from "../../lib/useDebouncedValue";

const DEBOUNCE_MS = 200;
const NO_RESULTS: SearchResponse = { clients: [], enquiries: [], quotes: [] };

/**
 * Debounced search over the agency's clients, enquiries and quotes. Like the airport lookup, results
 * that belong to an earlier term are never returned, so nothing stale can be picked.
 */
export function useRecordSearch(term: string) {
  const live = term.trim();
  const settled = useDebouncedValue(live, DEBOUNCE_MS);
  const query = useQuery({ ...recordSearchQueryOptions(settled), placeholderData: keepPreviousData });
  const enabled = settled.length >= MIN_SEARCH_LENGTH && live.length >= MIN_SEARCH_LENGTH;
  const isStale = live !== settled || query.isPlaceholderData;
  const current = enabled && !isStale;
  return {
    results: current ? (query.data ?? NO_RESULTS) : NO_RESULTS,
    /** A search for the live term is due or in flight. */
    pending: live.length >= MIN_SEARCH_LENGTH && (isStale || query.isPending),
    error: current ? query.error : null,
  };
}
