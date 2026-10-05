import { ArrowLeftRight, Search, X } from "lucide-react";
import { useId, useState } from "react";
import type { Cabin, FlightSearchRequest } from "../../api/offers";
import { isoDateFromNow } from "../../lib/dates";
import { clampGuests } from "../../lib/guests";
import { Button } from "../../ui/Button";
import { cn } from "../../ui/cn";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { FIELD_CONTROL, FIELD_LABEL, TextField } from "../../ui/TextField";
import { AirportPicker } from "../airports/AirportPicker";
import { routeStore, useRouteSelection } from "../route/routeStore";
import { MAX_PASSENGERS } from "./fareSearchParams";

export const CABINS: { value: Cabin; label: string }[] = [
  { value: "economy", label: "Economy" },
  { value: "premium_economy", label: "Premium economy" },
  { value: "business", label: "Business" },
  { value: "first", label: "First" },
];

/** The cabin switch: the kit's segmented control, allowed to wrap onto a second line on a phone. */
const CABIN_SEG = "h-auto! flex-wrap! [&>label]:min-h-8 [&>label]:py-1!";

/**
 * The fare search card in the kit's form recipe: route and dates on the first row (the route takes the spare
 * width; the dates wrap under it on tablets), then adults, any children, the cabin as a segmented switch and the
 * scan button. Everything stacks on phones.
 */
export function FareSearchForm({
  busy,
  onSearch,
  initial = {},
}: {
  busy: boolean;
  onSearch: (request: FlightSearchRequest) => void;
  /**
   * Starting values, e.g. an enquiry's trip; read when the form mounts. Children (their ages) come only
   * from the trip: the form shows them and can drop them, but has no field to add them.
   */
  initial?: { depart?: string; returning?: string; adults?: number; children?: readonly number[]; cabin?: Cabin };
}) {
  const id = useId();
  const { origin, destination } = useRouteSelection();
  const [departure, setDeparture] = useState(() => initial.depart ?? isoDateFromNow(14));
  const [returning, setReturning] = useState(() => initial.returning ?? "");
  // A draft string so the field can be cleared and retyped; it is clamped on blur and on submit.
  const [adults, setAdults] = useState(() => String(Math.min(initial.adults ?? 1, MAX_PASSENGERS - (initial.children?.length ?? 0))));
  const [cabin, setCabin] = useState<Cabin>(() => initial.cabin ?? "economy");
  const [children, setChildren] = useState<readonly number[]>(() => initial.children ?? []);
  // Adults fill the seats the children leave.
  const maxAdults = MAX_PASSENGERS - children.length;

  const sameAirport = origin !== null && destination !== null && origin.iata_code === destination.iata_code;
  const departsInPast = departure !== "" && departure < isoDateFromNow(0);
  const returnTooEarly = returning !== "" && returning < departure;
  const ready =
    origin !== null && destination !== null && !sameAirport && departure !== "" && !departsInPast && !returnTooEarly;

  return (
    <form
      aria-label="Search flights"
      className="card flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || !origin || !destination) return;
        const travellers = clampGuests(adults, maxAdults);
        setAdults(String(travellers));
        onSearch({
          origin: origin.iata_code,
          destination: destination.iata_code,
          departure_date: departure,
          return_date: returning || null,
          adults: travellers,
          children_ages: [...children],
          cabin,
          max_connections: 1,
        });
      }}
    >
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
      </div>

      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-t border-line pt-4">
        <div className="field w-24 gap-1.5">
          <label htmlFor={`${id}-adults`} className={FIELD_LABEL}>
            Adults
          </label>
          <input
            id={`${id}-adults`}
            type="number"
            min={1}
            max={maxAdults}
            value={adults}
            onChange={(e) => setAdults(e.target.value)}
            onBlur={() => setAdults(String(clampGuests(adults, maxAdults)))}
            className={cn(FIELD_CONTROL, "border-line-strong font-mono")}
          />
        </div>
        {children.length > 0 && (
          <div className="field gap-1.5">
            <span className={FIELD_LABEL}>Children</span>
            <p className="flex h-10 items-center gap-1 rounded-[12px] border border-line bg-card-2 pl-3.5 pr-1">
              <span className="font-mono text-[13px] text-ink">
                {`${children.length} (age${children.length === 1 ? "" : "s"} ${children.join(", ")})`}
              </span>
              <Button variant="ghost" size="sm" iconOnly aria-label="Remove children" onClick={() => setChildren([])}>
                <X size={14} aria-hidden="true" />
              </Button>
            </p>
          </div>
        )}
        <div className="field min-w-0 gap-1.5">
          {/* The switch carries the name "Cabin" itself; this is its visible label. */}
          <span aria-hidden="true" className={FIELD_LABEL}>
            Cabin
          </span>
          <SegmentedControl label="Cabin" value={cabin} onChange={setCabin} options={CABINS} className={CABIN_SEG} />
        </div>
        <p className="min-w-0 basis-56 pb-2.5 text-xs leading-4 text-dim lg:ml-auto lg:text-right">
          Up to 1 connection · prices for all travellers, taxes included
        </p>
        <Button type="submit" disabled={!ready} loading={busy} className="shrink-0 max-sm:w-full">
          {!busy && <Search size={15} aria-hidden="true" />}
          Scan fares
        </Button>
      </div>
      {sameAirport && (
        <p role="alert" className="text-[13px] text-warn">
          Pick two different airports.
        </p>
      )}
    </form>
  );
}
