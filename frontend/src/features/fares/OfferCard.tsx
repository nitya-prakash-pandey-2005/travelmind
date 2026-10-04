import { useMutation } from "@tanstack/react-query";
import { ChevronDown, CircleAlert, CircleCheck, Leaf, Luggage } from "lucide-react";
import { useId, useState } from "react";
import { asApiError } from "../../api/client";
import { offersApi, type Cabin, type FlightOffer, type Insight, type Money, type Segment, type Slice } from "../../api/offers";
import { dayShift, localTime } from "../../lib/dates";
import { formatDuration, formatNumber } from "../../lib/format";
import { formatMoney } from "../../lib/money";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { cn } from "../../ui/cn";
import { ProvenanceBadge } from "../../ui/ProvenanceBadge";

const INSIGHT: Record<Insight["signal"], { tone: "ok" | "neutral" | "warn"; label: string }> = {
  good: { tone: "ok", label: "Good price" },
  typical: { tone: "neutral", label: "Typical price" },
  high: { tone: "warn", label: "High price" },
};

/** Where the CO₂ figure came from, shown next to it (the Google TIM credit is the results footnote). */
const CO2_SOURCE: Record<NonNullable<FlightOffer["co2_source"]>, string> = {
  google_tim: "this flight",
  google_tim_typical: "route typical",
  supplier: "supplier est.",
};

const CABIN: Record<Cabin, string> = {
  economy: "Economy",
  premium_economy: "Premium economy",
  business: "Business",
  first: "First",
};

const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** Airport-local "2026-11-20T06:10:00" as a UTC instant, so local times at the same airport can be subtracted. */
function asUtc(iso: string): number {
  return Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
    Number(iso.slice(11, 13)),
    Number(iso.slice(14, 16)),
  );
}

/** "Fri 20 Nov" for an airport-local timestamp. */
function localDay(iso: string): string {
  return DAY.format(new Date(asUtc(iso)));
}

/** "Outbound" and "Return" for a round trip; numbered journeys for anything longer. */
function journeyLabel(index: number, count: number): string {
  if (count === 1) return "Flight";
  if (count === 2) return index === 0 ? "Outbound" : "Return";
  return `Journey ${index + 1}`;
}

export function stopsLabel(slice: Slice): string {
  const vias = slice.segments.slice(0, -1).map((s) => s.destination);
  if (vias.length === 0) return "Nonstop";
  return `${vias.length} stop${vias.length > 1 ? "s" : ""} · ${vias.join(", ")}`;
}

function bagsLabel(count: number, kind: "checked" | "cabin"): string {
  if (count === 0) return kind === "checked" ? "No checked bag" : "No cabin bag";
  return `${count} ${kind} bag${count > 1 ? "s" : ""}`;
}

function conditionLabel(allowed: boolean | null, penalty: Money | null, noun: "Changes" | "Refunds"): string {
  if (allowed === null) return `${noun}: not stated by the supplier`;
  if (!allowed) return `${noun}: not allowed`;
  return penalty && penalty.amount_minor > 0 ? `${noun}: allowed, fee ${formatMoney(penalty)}` : `${noun}: allowed, no fee`;
}

/** One journey: departure, a rail with the stops, arrival (+1 when it lands on a later day). */
function SliceRail({ slice }: { slice: Slice }) {
  const first = slice.segments[0];
  const last = slice.segments[slice.segments.length - 1];
  if (!first || !last) return null;
  const shift = dayShift(first.departing_at, last.arriving_at);
  const stops = slice.segments.length - 1;
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
      <div className="flex flex-col">
        <span className="tm-num text-lg font-medium leading-6 text-ink">{localTime(first.departing_at)}</span>
        <span className="font-mono text-xs leading-4 text-dim">{slice.origin}</span>
      </div>
      <div className="flex min-w-0 flex-col items-center gap-1 text-xs leading-4">
        <span className="tm-num text-dim">{slice.duration_minutes !== null ? formatDuration(slice.duration_minutes) : "—"}</span>
        <span aria-hidden="true" className="relative flex h-2 w-full items-center">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full border border-line-strong" />
          <span className="h-px flex-1 bg-line-strong" />
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-line-strong" />
          {Array.from({ length: stops }, (_, index) => (
            <span
              key={index}
              className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-warn"
              style={{ left: `${((index + 1) / (stops + 1)) * 100}%` }}
            />
          ))}
        </span>
        <span className={cn("max-w-full truncate", stops === 0 ? "text-dim" : "text-ink")}>{stopsLabel(slice)}</span>
      </div>
      <div className="flex flex-col items-end">
        <span className="tm-num text-lg font-medium leading-6 text-ink">
          {localTime(last.arriving_at)}
          {shift > 0 && (
            <sup className="ml-0.5 font-sans text-[11px] font-medium text-warn">
              +{shift}
              <span className="sr-only"> day{shift > 1 ? "s" : ""}</span>
            </sup>
          )}
        </span>
        <span className="font-mono text-xs leading-4 text-dim">{slice.destination}</span>
      </div>
    </div>
  );
}

function SegmentRow({ segment }: { segment: Segment }) {
  const operatedBy =
    segment.operating_carrier && segment.operating_carrier !== segment.marketing_carrier ? segment.operating_carrier : null;
  return (
    <li className="grid gap-x-4 gap-y-0.5 py-2 sm:grid-cols-[7rem_minmax(0,1fr)_auto]">
      <span className="font-mono text-ink">
        {segment.marketing_carrier} {segment.flight_number}
      </span>
      <span className="min-w-0 text-dim">
        <span className="font-mono text-ink">{segment.origin}</span> {localTime(segment.departing_at)}
        <span aria-hidden="true"> → </span>
        <span className="sr-only"> to </span>
        <span className="font-mono text-ink">{segment.destination}</span> {localTime(segment.arriving_at)}
        <span className="text-faint"> · {localDay(segment.departing_at)}</span>
        {operatedBy && <span className="text-faint"> · Operated by {operatedBy}</span>}
      </span>
      <span className="tm-num text-dim sm:text-right">
        {segment.duration_minutes !== null ? formatDuration(segment.duration_minutes) : "—"}
      </span>
    </li>
  );
}

/** Every flight of every journey, with the connection time between flights. */
function SliceDetails({ slice, label }: { slice: Slice; label: string }) {
  return (
    <div className="flex flex-col">
      <p className="hud">
        {label} · {slice.origin} → {slice.destination}
        {slice.fare_brand ? ` · ${slice.fare_brand}` : ""}
      </p>
      <ol className="flex flex-col divide-y divide-line text-[13px] leading-5">
        {slice.segments.map((segment, index) => {
          const next = slice.segments[index + 1];
          const layover = next ? Math.round((asUtc(next.departing_at) - asUtc(segment.arriving_at)) / 60_000) : null;
          return [
            <SegmentRow key={`${segment.flight_number}-${index}`} segment={segment} />,
            layover !== null && layover >= 0 && (
              <li key={`layover-${index}`} className="py-1.5 text-xs text-dim">
                Connection at <span className="font-mono text-ink">{segment.destination}</span> ·{" "}
                <span className="tm-num">{formatDuration(layover)}</span>
              </li>
            ),
          ];
        })}
      </ol>
    </div>
  );
}

/** Selectable mode (the quote builder): an "Add to quote" checkbox under "Verify price". */
export type OfferSelection = {
  selected: boolean;
  onChange: (selected: boolean) => void;
  /** Why the offer can't be added (another currency, the option limit); the checkbox is then disabled. */
  disabledReason?: string | null;
  /** Hold the checkbox as it is, ticked or not (e.g. while the selection is being saved). */
  frozen?: boolean;
};

export type OfferCardProps = { offer: FlightOffer; selectable?: OfferSelection };

/** The "Add to quote" checkbox, with the reason when it can't be ticked. */
function AddToQuote({ selection }: { selection: OfferSelection }) {
  const id = useId();
  const blocked = Boolean(selection.disabledReason) && !selection.selected;
  const disabled = blocked || Boolean(selection.frozen);
  return (
    <div className="mt-2 flex max-w-44 flex-col items-end gap-1">
      <label
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-[10px] border px-2.5 text-[13px] font-medium transition-colors duration-150 ease-tm",
          "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary",
          selection.selected
            ? "border-primary/60 bg-primary/10 text-ink"
            : disabled
              ? "cursor-not-allowed border-line text-faint"
              : "cursor-pointer border-line-strong bg-card-2 text-ink hover:border-faint hover:bg-hover",
        )}
      >
        <input
          type="checkbox"
          checked={selection.selected}
          disabled={disabled}
          aria-describedby={blocked ? id : undefined}
          onChange={(event) => selection.onChange(event.target.checked)}
          className="h-3.5 w-3.5 accent-primary"
        />
        Add to quote
      </label>
      {blocked && (
        <p id={id} className="text-right text-[11px] leading-4 text-dim">
          {selection.disabledReason}
        </p>
      )}
    </div>
  );
}

/**
 * A flight offer as a result card: carrier, each journey as a timeline, price (≈ when converted, with the
 * billed original), provenance, fare insight and the facts agents check (bags, refunds, CO₂). "Verify price"
 * asks the supplier again; "Flight details" opens every flight, connection and fare condition. With
 * `selectable` (the quote builder) it also offers "Add to quote".
 */
export function OfferCard({ offer, selectable }: OfferCardProps) {
  const reprice = useMutation({ mutationFn: () => offersApi.reprice(offer.id) });
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const carrier = offer.owner_name ?? offer.owner_carrier;
  const shown = offer.display_total ?? offer.total;
  const converted = offer.display_total !== null && offer.display_total.currency !== offer.total.currency;
  const price = formatMoney(shown);
  const { checked, carry_on: carryOn } = offer.baggage;
  const flights = offer.slices.map((slice) => slice.segments.map((s) => `${s.marketing_carrier} ${s.flight_number}`).join(", "));
  const brand = offer.slices[0]?.fare_brand;
  const fareLine = [offer.cabin ? CABIN[offer.cabin] : null, brand].filter(Boolean).join(" · ");

  return (
    <article
      aria-label={converted ? `${carrier} about ${price}` : `${carrier} ${price}`}
      className={cn(
        "card p-0 transition-colors duration-150 ease-tm",
        selectable?.selected ? "border-primary/70" : "hover:border-line-strong",
      )}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-4 p-[18px] md:grid-cols-[11rem_minmax(0,1fr)_auto]">
        <div className="col-start-1 row-start-1 flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-line bg-card-2 font-mono text-xs font-semibold text-ink"
          >
            {offer.owner_carrier}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium leading-5 text-ink">{carrier}</p>
            {flights.map((line, index) => (
              <p key={index} className="truncate font-mono text-[11px] leading-4 text-faint">
                {line}
              </p>
            ))}
            {fareLine && <p className="truncate text-xs leading-4 text-dim">{fareLine}</p>}
          </div>
        </div>

        <div className="col-span-2 row-start-2 flex min-w-0 flex-col gap-3 md:col-span-1 md:col-start-2 md:row-start-1">
          {offer.slices.map((slice, index) => (
            <SliceRail key={`${slice.origin}-${slice.destination}-${index}`} slice={slice} />
          ))}
        </div>

        <div className="col-start-2 row-start-1 flex flex-col items-end gap-0.5 text-right md:col-start-3 md:min-w-36 md:border-l md:border-line md:pl-6">
          <p className="tm-num font-display text-[22px] font-semibold leading-7 tracking-[-0.02em] text-ink">
            {converted && <span className="font-normal text-dim">≈ </span>}
            {price}
          </p>
          {converted && <p className="text-xs leading-4 text-dim">Billed {formatMoney(offer.total)}</p>}
          {offer.passenger_count > 1 && (
            <p className="text-xs leading-4 text-dim">Total for {offer.passenger_count} travellers</p>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            loading={reprice.isPending}
            onClick={() => reprice.mutate()}
          >
            Verify price
          </Button>
          {selectable && <AddToQuote selection={selectable} />}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-[18px] py-2.5 text-xs leading-4 text-dim">
        <span className="flex flex-wrap items-center gap-1.5">
          <ProvenanceBadge provenance={offer.provenance} />
          {offer.insight && <Badge tone={INSIGHT[offer.insight.signal].tone}>{INSIGHT[offer.insight.signal].label}</Badge>}
        </span>
        {checked !== null && (
          <span className="inline-flex items-center gap-1.5">
            <Luggage size={13} aria-hidden="true" className="text-faint" />
            {bagsLabel(checked, "checked")}
          </span>
        )}
        {offer.conditions.refundable !== null && (
          <span>{offer.conditions.refundable ? "Refundable" : "Non-refundable"}</span>
        )}
        {offer.co2_kg_per_passenger !== null && (
          <span className="inline-flex items-center gap-1.5">
            <Leaf size={13} aria-hidden="true" className="text-faint" />
            <span>
              {formatNumber(offer.co2_kg_per_passenger)} kg CO₂e
              {offer.co2_source && ` · ${CO2_SOURCE[offer.co2_source]}`}
            </span>
          </span>
        )}
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded((open) => !open)}
          className="-mr-1.5 ml-auto inline-flex h-8 items-center gap-1 rounded-[10px] px-2 font-medium text-dim transition-colors duration-150 ease-tm hover:bg-card-2 hover:text-ink"
        >
          Flight details
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={cn("transition-transform duration-150 ease-tm", expanded && "rotate-180")}
          />
        </button>
      </div>

      {expanded && (
        <div id={detailsId} className="flex flex-col gap-4 border-t border-line bg-card-2 px-[18px] py-3">
          {offer.slices.map((slice, index) => (
            <SliceDetails
              key={`${slice.origin}-${slice.destination}-${index}`}
              slice={slice}
              label={journeyLabel(index, offer.slices.length)}
            />
          ))}
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-xs leading-4 text-dim">
            {carryOn !== null && <li>{bagsLabel(carryOn, "cabin")}</li>}
            <li>{conditionLabel(offer.conditions.changeable, offer.conditions.change_penalty, "Changes")}</li>
            <li>{conditionLabel(offer.conditions.refundable, offer.conditions.refund_penalty, "Refunds")}</li>
            <li>
              Supplier <span className="font-mono text-ink">{offer.supplier}</span> · Ref{" "}
              <span className="font-mono text-ink">{offer.supplier_ref}</span>
            </li>
          </ul>
        </div>
      )}

      {reprice.isSuccess && (
        <div className="border-t border-line px-[18px] py-2.5">
          {reprice.data.price_changed ? (
            <p role="status" className="flex items-center gap-2 text-[13px] text-warn">
              <CircleAlert size={14} aria-hidden="true" className="shrink-0" />
              {`Price changed · now ${formatMoney(reprice.data.offer.total)} (was ${formatMoney(reprice.data.previous_total)})`}
            </p>
          ) : (
            <p role="status" className="flex items-center gap-2 text-[13px] text-ok">
              <CircleCheck size={14} aria-hidden="true" className="shrink-0" />
              {`Price confirmed · ${formatMoney(reprice.data.offer.total)}`}
            </p>
          )}
        </div>
      )}
      {reprice.isError && (
        <div className="border-t border-line px-[18px] py-2.5">
          <p role="alert" className="flex items-center gap-2 text-[13px] text-danger">
            <CircleAlert size={14} aria-hidden="true" className="shrink-0" />
            {asApiError(reprice.error).message}
          </p>
        </div>
      )}
    </article>
  );
}
