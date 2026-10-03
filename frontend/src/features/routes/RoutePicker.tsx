import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight } from "lucide-react";
import { useId } from "react";
import type { Cabin } from "../../api/offers";
import { referenceApi } from "../../api/reference";
import type { Airport } from "../../api/types";
import { Button } from "../../ui/Button";
import { cn } from "../../ui/cn";
import { FIELD_CONTROL, FIELD_LABEL } from "../../ui/TextField";
import { AirportPicker } from "../airports/AirportPicker";
import { CABINS } from "../fares/FareSearchForm";

const airportKey = (code: string) => ["reference", "airport-code", code] as const;

/**
 * The airport behind a code from the address, looked up once and then kept. While it loads (or when the
 * code is unknown) a stand-in with just the code keeps the field filled; the route figures say if the
 * server doesn't know the airport.
 */
function useAirport(code: string | undefined): Airport | null {
  const lookup = useQuery({
    queryKey: airportKey(code ?? ""),
    queryFn: async ({ signal }) => {
      const found = await referenceApi.searchAirports(code ?? "", 8, signal);
      return found.find((airport) => airport.iata_code === code) ?? null;
    },
    enabled: Boolean(code),
    staleTime: Infinity,
    retry: false,
  });
  if (!code) return null;
  return (
    lookup.data ?? {
      iata_code: code,
      name: lookup.isPending ? "Looking up airport…" : "Airport",
      city: null,
      country_code: "",
      country_name: "",
      latitude: 0,
      longitude: 0,
    }
  );
}

type RoutePickerProps = {
  origin: string | undefined;
  destination: string | undefined;
  cabin: Cabin;
  onChange: (next: { origin?: string; destination?: string; cabin?: Cabin }) => void;
};

/** Origin, a swap button, destination and cabin: the route whose fares the page shows. */
export function RoutePicker({ origin, destination, cabin, onChange }: RoutePickerProps) {
  const id = useId();
  const client = useQueryClient();
  const from = useAirport(origin);
  const to = useAirport(destination);

  function pick(side: "origin" | "destination", airport: Airport | null) {
    if (airport) client.setQueryData(airportKey(airport.iata_code), airport);
    const code = airport?.iata_code;
    const other = side === "origin" ? destination : origin;
    // Picking the airport already on the other side swaps the pair instead of making a route to itself.
    if (code && code === other) {
      onChange({ origin: destination, destination: origin, cabin });
      return;
    }
    onChange({ origin, destination, cabin, [side]: code });
  }

  return (
    <section
      aria-label="Route"
      className="mb-4 grid gap-3 rounded-lg border border-line bg-surface p-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_11rem] md:items-end"
    >
      <AirportPicker label="Origin" value={from} onChange={(airport) => pick("origin", airport)} />
      <Button
        variant="secondary"
        iconOnly
        aria-label="Swap origin and destination"
        title="Swap origin and destination"
        disabled={!origin && !destination}
        onClick={() => onChange({ origin: destination, destination: origin, cabin })}
        className="justify-self-start md:mb-0.5 md:justify-self-center"
      >
        <ArrowLeftRight size={15} aria-hidden="true" className="max-md:rotate-90" />
      </Button>
      <AirportPicker label="Destination" value={to} onChange={(airport) => pick("destination", airport)} />
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={`${id}-cabin`} className={FIELD_LABEL}>
          Cabin
        </label>
        <select
          id={`${id}-cabin`}
          value={cabin}
          onChange={(event) => onChange({ origin, destination, cabin: event.target.value as Cabin })}
          className={cn(FIELD_CONTROL, "cursor-pointer border-line-strong")}
        >
          {CABINS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
