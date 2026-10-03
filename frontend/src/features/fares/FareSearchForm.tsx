import { ArrowLeftRight, ChevronDown, Search } from "lucide-react";
import { useId, useState } from "react";
import type { Cabin, FlightSearchRequest } from "../../api/offers";
import { isoDateFromNow } from "../../lib/dates";
import { clampGuests } from "../../lib/guests";
import { Button } from "../../ui/Button";
import { cn } from "../../ui/cn";
import { FIELD_LABEL, TextField } from "../../ui/TextField";
import { AirportPicker } from "../airports/AirportPicker";
import { routeStore, useRouteSelection } from "../route/routeStore";

export const CABINS: { value: Cabin; label: string }[] = [
  { value: "economy", label: "Economy" },
  { value: "premium_economy", label: "Premium economy" },
  { value: "business", label: "Business" },
  { value: "first", label: "First" },
];

/** A 32px field for the toolbar above the route (the form's full-size fields are 36px). */
const COMPACT_CONTROL = cn(
  "h-8 min-w-0 rounded-md border border-line-strong bg-surface-2 px-2.5 text-sm text-ink",
  "transition-colors duration-150 ease-tm hover:border-faint focus:border-primary",
);

/** Travellers per search (the field's max). */
const MAX_ADULTS = 9;

/**
 * The fare search bar: adults and cabin on a toolbar, then route, dates and the scan button in one row on
 * laptops. The route takes the spare width; the dates wrap under it on tablets and everything stacks on phones.
 */
export function FareSearchForm({ busy, onSearch }: { busy: boolean; onSearch: (request: FlightSearchRequest) => void }) {
  const id = useId();
  const { origin, destination } = useRouteSelection();
  const [departure, setDeparture] = useState(() => isoDateFromNow(14));
  const [returning, setReturning] = useState("");
  // A draft string so the field can be cleared and retyped; it is clamped on blur and on submit.
  const [adults, setAdults] = useState("1");
  const [cabin, setCabin] = useState<Cabin>("economy");

  const sameAirport = origin !== null && destination !== null && origin.iata_code === destination.iata_code;
  const departsInPast = departure !== "" && departure < isoDateFromNow(0);
  const returnTooEarly = returning !== "" && returning < departure;
  const ready =
    origin !== null && destination !== null && !sameAirport && departure !== "" && !departsInPast && !returnTooEarly;

  return (
    <form
      aria-label="Search flights"
      className="rounded-lg border border-line bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || !origin || !destination) return;
        const travellers = clampGuests(adults, MAX_ADULTS);
        setAdults(String(travellers));
        onSearch({
          origin: origin.iata_code,
          destination: destination.iata_code,
          departure_date: departure,
          return_date: returning || null,
          adults: travellers,
          children_ages: [],
          cabin,
          max_connections: 1,
        });
      }}
    >
      {/* Party and cabin sit on a toolbar above the route, so the route and dates get the row's width. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line pb-3">
        <div className="flex items-center gap-2">
          <label htmlFor={`${id}-adults`} className={FIELD_LABEL}>
            Adults
          </label>
          <input
            id={`${id}-adults`}
            type="number"
            min={1}
            max={MAX_ADULTS}
            value={adults}
            onChange={(e) => setAdults(e.target.value)}
            onBlur={() => setAdults(String(clampGuests(adults, MAX_ADULTS)))}
            className={cn(COMPACT_CONTROL, "w-16 font-mono")}
          />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor={`${id}-cabin`} className={FIELD_LABEL}>
            Cabin
          </label>
          <div className="relative">
            <select
              id={`${id}-cabin`}
              value={cabin}
              onChange={(e) => setCabin(e.target.value as Cabin)}
              className={cn(COMPACT_CONTROL, "w-44 cursor-pointer appearance-none pr-8")}
            >
              {CABINS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <ChevronDown
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-dim"
            />
          </div>
        </div>
        <p className="text-xs leading-4 text-dim sm:ml-auto">Up to 1 connection · prices for all travellers, taxes included</p>
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <div className="grid min-w-0 grow-[3] basis-[24rem] items-start gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-2">
          <AirportPicker label="From" value={origin} onChange={(a) => routeStore.setOrigin(a)} />
          <div className="hidden pt-[26px] sm:block">
            <Button
              variant="ghost"
              iconOnly
              aria-label="Swap From and To"
              disabled={!origin && !destination}
              onClick={() => routeStore.swap()}
            >
              <ArrowLeftRight size={15} aria-hidden="true" />
            </Button>
          </div>
          <AirportPicker label="To" value={destination} onChange={(a) => routeStore.setDestination(a)} />
        </div>
        <div className="grid min-w-0 grow basis-[19rem] grid-cols-2 items-start gap-3">
          <TextField
            label="Depart"
            type="date"
            required
            min={isoDateFromNow(0)}
            value={departure}
            error={departsInPast ? "Departure can't be in the past." : undefined}
            onChange={(e) => setDeparture(e.target.value)}
          />
          <TextField
            label="Return (optional)"
            type="date"
            min={departure}
            value={returning}
            error={returnTooEarly ? "Return must be on or after departure." : undefined}
            onChange={(e) => setReturning(e.target.value)}
          />
        </div>
        {/* 26px = a field label (20px) and its gap (6px): lines the button up with the inputs beside it. */}
        <Button type="submit" disabled={!ready} loading={busy} className="shrink-0 max-sm:w-full sm:mt-[26px]">
          {!busy && <Search size={15} aria-hidden="true" />}
          Scan fares
        </Button>
      </div>
      {sameAirport && (
        <p role="alert" className="mt-3 text-[13px] text-warn">
          Pick two different airports.
        </p>
      )}
    </form>
  );
}
