import { ArrowLeftRight, CircleCheck, Info, Leaf, Luggage, ReceiptText } from "lucide-react";
import { useId } from "react";
import { INDICATIVE_PRICE_LABEL, LIVE_PRICE_LABEL, type PublicOption, type PublicSlice } from "../../api/publicQuotes";
import { dayShift, localTime } from "../../lib/dates";
import { formatDuration } from "../../lib/format";
import { formatMoney } from "../../lib/money";
import { cn } from "../../ui/cn";
import { AccentButton } from "./AccentButton";
import {
  asUtc,
  baggageLabel,
  CABIN_LABEL,
  carrierName,
  changeLabel,
  co2Label,
  journeyLabel,
  refundLabel,
  stopsLabel,
  travelDay,
} from "./format";

/**
 * The price label the constraints require, as a kit badge: green with a live dot for a live fare, neutral with an
 * info mark otherwise. Anything but the live label reads as indicative, so no other wording from the server ever
 * reaches the client.
 */
export function PriceLabel({ label, className }: { label: PublicOption["price_label"]; className?: string }) {
  const live = label === LIVE_PRICE_LABEL;
  const text = live ? LIVE_PRICE_LABEL : INDICATIVE_PRICE_LABEL;
  return (
    <p className={className}>
      <span
        className={cn(
          "badge tone-fill max-w-full items-start whitespace-normal rounded-[12px] px-2.5 py-1 text-[11.5px] font-medium leading-4",
          live ? "text-ok" : "text-dim",
        )}
      >
        {live ? (
          <span aria-hidden="true" className="dot mt-[4.5px] h-1.5! w-1.5!" />
        ) : (
          <Info size={13} strokeWidth={1.75} aria-hidden="true" className="mt-px shrink-0" />
        )}
        <span className={live ? "text-ink" : undefined}>{text}</span>
      </span>
    </p>
  );
}

/** One journey: departure, a rail with duration and stops, arrival (+1 on a later day), then its flights. */
function Journey({ slice, label }: { slice: PublicSlice; label: string }) {
  const shift = dayShift(slice.departing_at, slice.arriving_at);
  const stops = Math.max(slice.stops, slice.segments.length - 1);
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-xs leading-4 text-dim">
        <span className="font-medium text-ink">{label}</span>
        <span aria-hidden="true"> · </span>
        <span className="sr-only">, </span>
        {travelDay(slice.departing_at)}
      </p>
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 sm:gap-4">
        <div className="flex flex-col">
          <span className="num text-xl font-semibold leading-7 text-ink">{localTime(slice.departing_at)}</span>
          <span className="font-mono text-xs leading-4 text-dim">{slice.origin}</span>
        </div>
        <div className="flex min-w-0 flex-col items-center gap-1 text-xs leading-4">
          <span className="tm-num text-dim">
            {slice.duration_minutes !== null ? formatDuration(slice.duration_minutes) : ""}
          </span>
          <span aria-hidden="true" className="relative flex h-2 w-full items-center">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full border border-line-strong" />
            <span className="h-px flex-1 bg-line-strong" />
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--pq-accent)" />
            {Array.from({ length: stops }, (_, index) => (
              <span
                key={index}
                className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-line-strong"
                style={{ left: `${((index + 1) / (stops + 1)) * 100}%` }}
              />
            ))}
          </span>
          <span className={cn("max-w-full truncate", stops === 0 ? "text-dim" : "text-ink")}>{stopsLabel(slice)}</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="num text-xl font-semibold leading-7 text-ink">
            {localTime(slice.arriving_at)}
            {shift > 0 && (
              <sup className="ml-0.5 font-sans text-[11px] font-medium text-dim">
                +{shift}
                <span className="sr-only"> day{shift > 1 ? "s" : ""}</span>
              </sup>
            )}
          </span>
          <span className="font-mono text-xs leading-4 text-dim">{slice.destination}</span>
        </div>
      </div>
      <ol className="flex flex-col gap-0.5 text-xs leading-5 text-dim">
        {slice.segments.map((segment, index) => {
          const next = slice.segments[index + 1];
          const layover = next ? Math.round((asUtc(next.departing_at) - asUtc(segment.arriving_at)) / 60_000) : null;
          return (
            <li key={`${segment.flight_number}-${index}`} className="flex flex-wrap gap-x-2">
              <span className="font-mono text-ink">
                {segment.marketing_carrier} {segment.flight_number}
              </span>
              <span>
                {segment.origin} {localTime(segment.departing_at)}
                <span aria-hidden="true"> → </span>
                <span className="sr-only"> to </span>
                {segment.destination} {localTime(segment.arriving_at)}
              </span>
              {layover !== null && layover >= 0 && (
                <span className="text-faint">
                  · {formatDuration(layover)} connection in {segment.destination}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Fact({ icon: Icon, children }: { icon: typeof Luggage; children: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <Icon size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-faint" />
      <span>{children}</span>
    </li>
  );
}

export type OptionState = "open" | "accepted" | "closed";

type PublicOptionCardProps = {
  option: PublicOption;
  /** "open": the client can accept it; "accepted": the option they chose; "closed": shown for reference. */
  state: OptionState;
  /** Accepting is paused (the quote is reloading). */
  disabled?: boolean;
  onAccept?: () => void;
};

/**
 * One option as the client sees it: airline and cabin, each journey with times, stops and flights, the price
 * with its label and per-traveller share, and the facts a traveller checks (bags, refunds, changes, CO₂).
 */
export function PublicOptionCard({ option, state, disabled = false, onAccept }: PublicOptionCardProps) {
  const eyebrowId = useId();
  const titleId = useId();
  const number = option.index + 1;
  const accepted = state === "accepted";
  const details = [option.cabin ? CABIN_LABEL[option.cabin] : null, option.slices.length === 2 ? "Return trip" : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <article
      aria-labelledby={`${eyebrowId} ${titleId}`}
      className={cn(
        "card flush print:break-inside-avoid",
        accepted && "border-(color:--pq-accent) ring-1 ring-(color:--pq-accent)",
      )}
    >
      <header className="flex items-center justify-between gap-3 border-b border-line bg-card-2 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] border border-line-soft bg-card-2 font-mono text-xs font-semibold text-ink"
          >
            {option.carrier_code}
          </span>
          <div className="min-w-0">
            <p id={eyebrowId} className="hud">
              Option {number}
            </p>
            <h3 id={titleId} className="truncate font-display text-[16px] font-semibold leading-5 text-ink">
              {carrierName(option)}
            </h3>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {details && <span className="badge hidden sm:inline-flex">{details}</span>}
          {accepted && (
            <span className="badge tone-fill text-ok">
              <CircleCheck size={13} aria-hidden="true" />
              Accepted
            </span>
          )}
        </div>
      </header>

      <div className="grid md:grid-cols-[minmax(0,1fr)_15.5rem]">
        <div className="flex flex-col gap-5 px-4 py-4 sm:px-5 sm:py-5">
          {details && <p className="-mb-2 text-xs text-dim sm:hidden">{details}</p>}
          {option.slices.map((slice, index) => (
            <Journey
              key={`${slice.origin}-${slice.departing_at}`}
              slice={slice}
              label={journeyLabel(index, option.slices.length)}
            />
          ))}
        </div>
        <div className="flex flex-col border-t border-line bg-card-2 px-4 py-4 sm:px-5 sm:py-5 md:border-l md:border-t-0">
          <p className="hud">Total price</p>
          <p className="num mt-1 text-[28px] font-semibold leading-9 text-ink">
            {formatMoney(option.sell)}
          </p>
          {/* No share for one traveller (or a party with children): the total says it all. */}
          {option.per_traveller && (
            <p className="mt-0.5 text-[13px] leading-5 text-dim">
              <span className="tm-num">{formatMoney(option.per_traveller)}</span> per traveller
            </p>
          )}
          <PriceLabel label={option.price_label} className="mt-3" />
          {state === "open" && onAccept && (
            <div className="pt-4 md:mt-auto print:hidden">
              <AccentButton onClick={onAccept} disabled={disabled} className="w-full">
                Accept option {number}
              </AccentButton>
            </div>
          )}
        </div>
      </div>

      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 border-t border-line px-4 py-3 text-[13px] leading-5 text-dim sm:px-5">
        <Fact icon={Luggage}>{baggageLabel(option.baggage)}</Fact>
        <Fact icon={ReceiptText}>{refundLabel(option.refundable)}</Fact>
        <Fact icon={ArrowLeftRight}>{changeLabel(option.changeable)}</Fact>
        {option.co2_kg_per_passenger !== null && <Fact icon={Leaf}>{co2Label(option.co2_kg_per_passenger)}</Fact>}
      </ul>
    </article>
  );
}
