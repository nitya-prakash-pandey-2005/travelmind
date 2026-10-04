import { useQueries } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { airportSearchQueryOptions } from "../../api/queries";
import type { Airport } from "../../api/types";

/** Airports by code, looked up through the (cached) airport search: an exact code match only. */
export function useAirports(codes: readonly string[]): Map<string, Airport> {
  const combine = useCallback(
    (results: { data?: Airport[] }[]) => results.map((result, index) => result.data?.find((a) => a.iata_code === codes[index]) ?? null),
    [codes],
  );
  // The combined list is structurally shared, so it keeps its identity until an airport resolves.
  const found = useQueries({ queries: codes.map((code) => airportSearchQueryOptions(code)), combine });
  return useMemo(() => new Map(found.flatMap((a) => (a ? [[a.iata_code, a] as const] : []))), [found]);
}
