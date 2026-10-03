import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { referenceApi } from "../../api/reference";
import type { Airport } from "../../api/types";
import { routeStore } from "../route/routeStore";

async function airportByCode(code: string | undefined, signal: AbortSignal): Promise<Airport | null> {
  if (!code) return null;
  const found = await referenceApi.searchAirports(code, 8, signal);
  return found.find((airport) => airport.iata_code === code) ?? null;
}

/**
 * Puts the airports named in Fare search's address into the shared route selection once they are
 * looked up. Unknown codes leave that side as it was; a failed lookup changes nothing.
 */
export function usePrefilledRoute(origin: string | undefined, destination: string | undefined): void {
  const lookup = useQuery({
    queryKey: ["reference", "airport-codes", origin ?? null, destination ?? null],
    queryFn: async ({ signal }) => {
      const [from, to] = await Promise.all([airportByCode(origin, signal), airportByCode(destination, signal)]);
      return { from, to };
    },
    enabled: Boolean(origin || destination),
    staleTime: Infinity,
    retry: false,
  });
  const found = lookup.data;

  useEffect(() => {
    if (!found) return;
    const current = routeStore.get();
    routeStore.set({ origin: found.from ?? current.origin, destination: found.to ?? current.destination });
  }, [found]);
}
