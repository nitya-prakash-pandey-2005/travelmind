import { ArrowLeftRight, Search } from "lucide-react";
import { useState } from "react";
import type { Cabin, FlightSearchRequest } from "../../api/offers";
import { isoDateFromNow } from "../../lib/dates";
import { clampGuests } from "../../lib/guests";
import { Button } from "../../ui/Button";
import { SelectField } from "../../ui/SelectField";
import { TextField } from "../../ui/TextField";
import { AirportPicker } from "../airports/AirportPicker";
import { routeStore, useRouteSelection } from "../route/routeStore";

export const CABINS: { value: Cabin; label: string }[] = [
  { value: "economy", label: "Economy" },
  { value: "premium_economy", label: "Premium economy" },
  { value: "business", label: "Business" },
  { value: "first", label: "First" },
];

/** Travellers per search (the field's max). */
const MAX_ADULTS = 9;

/**
 * The fare search bar: route, dates, travellers and cabin in one row on wide screens, wrapping to two rows
 * on tablets and stacking on phones.
 */
export function FareSearchForm({ busy, onSearch }: { busy: boolean; onSearch: (request: FlightSearchRequest) => void }) {
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
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
        <div className="grid min-w-0 items-start gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-2 xl:flex-[1.25]">
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
        <div className="grid min-w-0 grid-cols-2 items-start gap-3 sm:grid-cols-[1fr_1fr_5.5rem_minmax(0,1fr)] xl:flex-1">
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
          <TextField
            label="Adults"
            type="number"
            min={1}
            max={MAX_ADULTS}
            value={adults}
            onChange={(e) => setAdults(e.target.value)}
            onBlur={() => setAdults(String(clampGuests(adults, MAX_ADULTS)))}
          />
          <SelectField label="Cabin" value={cabin} onChange={(e) => setCabin(e.target.value as Cabin)}>
            {CABINS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </SelectField>
        </div>
        {/* 26px = a field label (20px) and its gap (6px): lines the button up with the inputs beside it. */}
        <Button
          type="submit"
          disabled={!ready}
          loading={busy}
          className="w-full sm:w-auto sm:self-end xl:mt-[26px] xl:self-start"
        >
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
