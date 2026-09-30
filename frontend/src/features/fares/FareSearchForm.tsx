import { useState } from "react";
import type { Cabin, FlightSearchRequest } from "../../api/offers";
import { isoDateFromNow } from "../../lib/dates";
import { clampGuests } from "../../lib/guests";
import { Button } from "../../ui/Button";
import { Panel } from "../../ui/Panel";
import { SelectField } from "../../ui/SelectField";
import { TextField } from "../../ui/TextField";
import { AirportPicker } from "../airports/AirportPicker";
import { routeStore, useRouteSelection } from "../route/routeStore";

const CABINS: { value: Cabin; label: string }[] = [
  { value: "economy", label: "Economy" },
  { value: "premium_economy", label: "Premium economy" },
  { value: "business", label: "Business" },
  { value: "first", label: "First" },
];

/** Travellers per search (the field's max). */
const MAX_ADULTS = 9;

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
    <Panel eyebrow="Fare scan" title="Scan live fares">
      <form
        className="flex flex-col gap-3"
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
        <AirportPicker label="From" value={origin} onChange={(a) => routeStore.setOrigin(a)} />
        <AirportPicker label="To" value={destination} onChange={(a) => routeStore.setDestination(a)} />
        <div className="grid gap-3 sm:grid-cols-2">
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
            label="Return"
            type="date"
            min={departure}
            value={returning}
            hint="Empty for one-way"
            error={returnTooEarly ? "Return must be on or after departure." : undefined}
            onChange={(e) => setReturning(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
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
        {sameAirport && (
          <p role="alert" className="text-sm text-warn">
            Pick two different airports.
          </p>
        )}
        <Button type="submit" disabled={!ready} loading={busy}>
          Scan fares
        </Button>
      </form>
    </Panel>
  );
}
