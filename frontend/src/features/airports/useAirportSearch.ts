import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { airportSearchQueryOptions } from "../../api/queries";
import { useDebouncedValue } from "../../lib/useDebouncedValue";

export const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 200;

/** Debounced airport lookup. Queries are keyed by term, so results always match the latest term. */
export function useAirportSearch(term: string) {
  const settled = useDebouncedValue(term.trim(), DEBOUNCE_MS);
  const enabled = settled.length >= MIN_QUERY_LENGTH;
  const query = useQuery({ ...airportSearchQueryOptions(settled), enabled, placeholderData: keepPreviousData });
  return {
    results: enabled ? (query.data ?? []) : [],
    enabled,
    isSearching: enabled && query.isFetching,
    error: query.error,
  };
}
