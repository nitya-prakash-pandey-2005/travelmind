import { BedDouble, CloudRain, CloudSun, Landmark, Leaf, Luggage, Plane, StickyNote, Sun } from "lucide-react";
import type {
  AgentBudget,
  AgentFlightCard,
  AgentHotelCard,
  AgentItineraryDay,
  AgentPlaceCard,
  AgentWeather,
  AgentWeatherDay,
  PlanResult,
} from "../../api/agent";
import { formatDuration, formatNumber } from "../../lib/format";
import { formatMoney } from "../../lib/money";
import { Badge } from "../../ui/Badge";
import { BarList, Donut } from "../../ui/charts";
import { cn } from "../../ui/cn";
import { Panel } from "../../ui/Panel";
import { ProvenanceBadge } from "../../ui/ProvenanceBadge";
import { CABIN_LABEL, shortDay, splitApprox } from "./agentText";

const INSIGHT = {
  good: { tone: "ok", label: "Good price" },
  typical: { tone: "neutral", label: "Typical price" },
  high: { tone: "warn", label: "High price" },
} as const;

/** "≈ ₹83,310" with the "≈" set apart in a quieter colour. */
export function Amount({ formatted, className }: { formatted: string; className?: string }) {
  const { approx, amount } = splitApprox(formatted);
  return (
    <span className={cn("tm-num whitespace-nowrap", className)}>
      {approx && <span className="font-normal text-dim">≈ </span>}
      {amount}
    </span>
  );
}

const time = (iso: string) => iso.slice(11, 16);

function journeyLabel(index: number, count: number): string {
  if (count === 1) return "Flight";
  if (count === 2) return index === 0 ? "Outbound" : "Return";
  return `Journey ${index + 1}`;
}

/**
 * A flight option from the plan, in the Fare search card's language: carrier, each journey as a rail, the
 * total (≈ when converted, with what the supplier bills), provenance, fare insight, bags, refunds and CO₂.
 * Read-only: the agent's options carry the run's own ids (F1), not a supplier offer to re-price.
 */
export function FlightOptionCard({ offer, travellers }: { offer: AgentFlightCard; travellers: number }) {
  const insight = offer.fare_insight ? INSIGHT[offer.fare_insight] : null;
  const carrier = offer.carrier_name ?? offer.carrier;
  const { amount } = splitApprox(offer.total_formatted);
  return (
    <article
      aria-label={offer.converted ? `${offer.offer_id} ${carrier} about ${amount}` : `${offer.offer_id} ${carrier} ${amount}`}
      className="rounded-lg border border-line bg-surface transition-colors duration-150 ease-tm hover:border-line-strong"
    >
      <div className="flex items-start gap-3 p-3.5">
        <span
          aria-hidden="true"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line bg-surface-2 font-mono text-xs font-semibold text-ink"
        >
          {offer.carrier}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate text-sm font-medium leading-5 text-ink">
            {carrier}
            <span className="rounded-[4px] border border-line px-1 font-mono text-[10px] leading-4 text-dim">{offer.offer_id}</span>
          </p>
          <p className="truncate font-mono text-[11px] leading-4 text-faint">{offer.flight_numbers.join(", ")}</p>
          {offer.cabin && <p className="truncate text-xs leading-4 text-dim">{CABIN_LABEL[offer.cabin]}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end text-right">
          <Amount formatted={offer.total_formatted} className="text-lg font-semibold leading-6 text-ink" />
          <p className="text-[11px] leading-4 text-dim">
            {travellers > 1 ? `Total for ${travellers} · ` : ""}
            <Amount formatted={offer.per_traveller_formatted} /> each
          </p>
          {offer.converted && <p className="text-[11px] leading-4 text-faint">Billed {offer.supplier_total_formatted}</p>}
        </div>
      </div>
      <div className="flex flex-col gap-2 border-t border-line px-3.5 py-2.5">
        {offer.slices.map((slice, index) => (
          <div key={`${slice.origin}-${index}`} className="grid grid-cols-[4.25rem_auto_minmax(0,1fr)_auto] items-center gap-x-2.5">
            <span className="tm-micro">{journeyLabel(index, offer.slices.length)}</span>
            <span className="flex flex-col">
              <span className="tm-num text-sm leading-5 text-ink">{time(slice.departs_at)}</span>
              <span className="font-mono text-[11px] leading-3 text-dim">{slice.origin}</span>
            </span>
            <span className="flex min-w-0 flex-col items-center gap-0.5 text-[11px] leading-3">
              <span className="tm-num text-faint">{slice.duration_minutes !== null ? formatDuration(slice.duration_minutes) : "—"}</span>
              <span aria-hidden="true" className="relative flex h-1.5 w-full items-center">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full border border-line-strong" />
                <span className="h-px flex-1 bg-line-strong" />
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-line-strong" />
              </span>
              <span className={slice.stops === 0 ? "text-dim" : "text-warn"}>
                {slice.stops === 0 ? "Nonstop" : `${slice.stops} stop${slice.stops > 1 ? "s" : ""}`}
              </span>
            </span>
            <span className="flex flex-col items-end">
              <span className="tm-num text-sm leading-5 text-ink">{time(slice.arrives_at)}</span>
              <span className="font-mono text-[11px] leading-3 text-dim">{slice.destination}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line px-3.5 py-2 text-xs leading-4 text-dim">
        <ProvenanceBadge provenance={offer.provenance} />
        {insight && <Badge tone={insight.tone}>{insight.label}</Badge>}
        {offer.checked_bags !== null && (
          <span className="inline-flex items-center gap-1">
            <Luggage size={12} aria-hidden="true" className="text-faint" />
            {offer.checked_bags === 0 ? "No checked bag" : `${offer.checked_bags} checked bag${offer.checked_bags > 1 ? "s" : ""}`}
          </span>
        )}
        {offer.refundable !== null && <span>{offer.refundable ? "Refundable" : "Non-refundable"}</span>}
        {offer.co2_kg_per_passenger !== null && (
          <span className="inline-flex items-center gap-1">
            <Leaf size={12} aria-hidden="true" className="text-faint" />
            {formatNumber(offer.co2_kg_per_passenger)} kg CO₂e each
          </span>
        )}
      </div>
      {offer.fare_insight_note && (
        <p className="border-t border-line px-3.5 py-2 text-xs leading-4 text-dim">{offer.fare_insight_note}</p>
      )}
    </article>
  );
}

export function HotelOptionCard({ hotel }: { hotel: AgentHotelCard }) {
  const facts = [hotel.room, hotel.board].filter(Boolean).join(" · ");
  return (
    <article aria-label={`${hotel.hotel_id} ${hotel.name}`} className="rounded-lg border border-line bg-surface p-3.5">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-dim">
          <BedDouble size={16} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium leading-5 text-ink">
            <span className="truncate">{hotel.name}</span>
            <span className="rounded-[4px] border border-line px-1 font-mono text-[10px] leading-4 text-dim">{hotel.hotel_id}</span>
          </p>
          <p className="truncate text-xs leading-4 text-dim">
            {[hotel.stars ? `${hotel.stars}-star` : null, hotel.rating !== null ? `rated ${hotel.rating}/10` : null, hotel.area]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {facts && <p className="truncate text-xs leading-4 text-faint">{facts}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end text-right">
          <Amount formatted={hotel.total_formatted} className="text-lg font-semibold leading-6 text-ink" />
          <p className="text-[11px] leading-4 text-dim">
            <Amount formatted={hotel.per_night_formatted} /> × {hotel.nights} night{hotel.nights === 1 ? "" : "s"}
          </p>
          {hotel.converted && <p className="text-[11px] leading-4 text-faint">Billed {hotel.supplier_total_formatted}</p>}
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs leading-4 text-dim">
        <ProvenanceBadge provenance={hotel.provenance} />
        {hotel.refundable !== null && (
          <span>
            {hotel.refundable
              ? hotel.free_cancellation_until
                ? `Free cancellation until ${hotel.free_cancellation_until}`
                : "Refundable"
              : "Non-refundable"}
          </span>
        )}
      </div>
    </article>
  );
}

export function PlaceList({ places, attribution }: { places: AgentPlaceCard[]; attribution: string | null }) {
  return (
    <>
      <ul className="grid gap-2 sm:grid-cols-2">
        {places.map((place) => (
          <li key={place.place_id} className="flex items-start gap-2.5 rounded-md border border-line px-3 py-2">
            <Landmark size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-faint" />
            <span className="min-w-0">
              <span className="block truncate text-[13px] leading-5 text-ink">{place.name}</span>
              <span className="block truncate text-[11px] leading-4 text-dim">
                {place.kind.replace(/_/g, " ")}
                {place.distance_km !== null && ` · ${place.distance_km.toFixed(1)} km from the centre`}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {attribution && <p className="mt-3 text-[11px] leading-4 text-faint">{attribution}</p>}
    </>
  );
}

function weatherIcon(day: AgentWeatherDay) {
  const chance = day.precipitation_chance_pct ?? 0;
  if (chance >= 50) return CloudRain;
  if (chance >= 20) return CloudSun;
  return Sun;
}

const degrees = (value: number | null) => (value === null ? "—" : `${Math.round(value)}°`);

/** One tile per day: high and low, rain chance, conditions when known. */
export function WeatherStrip({ weather }: { weather: AgentWeather }) {
  const days = weather.days.slice(0, 14);
  return (
    <>
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(3.5rem,1fr))] gap-1.5">
        {days.map((day) => {
          const Icon = weatherIcon(day);
          const { weekday, day: date } = shortDay(day.date);
          return (
            <li
              key={day.date}
              aria-label={`${day.date_display}: high ${degrees(day.temp_max_c)}, low ${degrees(day.temp_min_c)}, rain ${day.precipitation_chance_pct ?? "—"}%`}
              className="flex min-w-0 flex-col items-center gap-1 rounded-md border border-line bg-surface-2/60 px-1 py-2.5 text-center"
            >
              <span className="text-[11px] font-medium leading-4 text-dim">{weekday}</span>
              <span className="text-[11px] leading-3 text-faint">{date}</span>
              <Icon size={18} strokeWidth={1.6} aria-hidden="true" className="my-1 text-warn" />
              <span className="tm-num text-sm leading-4 text-ink">{degrees(day.temp_max_c)}</span>
              <span className="tm-num text-[11px] leading-3 text-dim">{degrees(day.temp_min_c)}</span>
              <span className="tm-num mt-0.5 text-[11px] leading-3 text-info">{day.precipitation_chance_pct ?? "—"}%</span>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-col gap-1 text-[11px] leading-4">
        {weather.note && <p className="text-dim">{weather.note}</p>}
        <p className="text-faint">
          High and low in {weather.units.temperature}, chance of rain · {weather.attribution}
        </p>
      </div>
    </>
  );
}

// --- day by day ----------------------------------------------------------------------------

export type DayEntry = { kind: "flight" | "hotel" | "place" | "note"; text: string; detail?: string };
/** `title` only when the run's own itinerary named the day; nothing is inferred. */
export type PlanDay = { date: string | null; label: string; title: string | null; entries: DayEntry[]; weather: AgentWeatherDay | null };
/** A hotel option the results give no dates for: listed, but on no day. */
export type UndatedStay = { name: string; ref: string };

const MAX_DAYS = 14;

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const dayLabel = (number: number, date: string | null) => {
  if (!date) return `Day ${number}`;
  const { weekday, day } = shortDay(date);
  return `Day ${number} · ${weekday} ${day}`;
};

/**
 * The plan's days. The itinerary the run built, when it has one. Otherwise one day per date of the trip
 * with only what the results tie to that date: the first flight option's departures (from its slices),
 * hotel check-in and check-out when the trip block has those dates, and the weather. A hotel without
 * dates in the results is returned in `undated`, never placed on a day.
 */
export function planDays(result: PlanResult): { days: PlanDay[]; built: boolean; undated: UndatedStay[] } {
  const weatherOn = new Map((result.weather?.days ?? []).map((day) => [day.date, day]));
  const trip = result.trip;
  if (result.itinerary.length > 0) {
    return {
      built: true,
      undated: [],
      days: result.itinerary.map((day: AgentItineraryDay) => ({
        date: day.date,
        label: dayLabel(day.day, day.date),
        title: day.title,
        entries: [
          ...day.items.map((item) => ({ kind: item.kind, text: item.label, detail: item.id })),
          ...(day.notes ? [{ kind: "note" as const, text: day.notes }] : []),
        ],
        weather: day.date ? (weatherOn.get(day.date) ?? null) : null,
      })),
    };
  }
  const start = trip?.depart_date ?? trip?.check_in;
  if (!trip || !start) return { days: [], built: false, undated: [] };
  const end = (trip.depart_date ? trip.return_date : trip.check_out) ?? start;
  const span = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
  const count = Math.min(MAX_DAYS, Math.max(1, (Number.isFinite(span) ? span : 0) + 1));
  const flight = result.flights[0];
  const hotel = result.hotels[0];
  const stayDated = Boolean(trip.check_in && trip.check_out);
  const days: PlanDay[] = [];
  for (let index = 0; index < count; index += 1) {
    const date = addDays(start, index);
    const entries: DayEntry[] = [];
    for (const slice of flight?.slices ?? []) {
      if (slice.departs_at.slice(0, 10) === date) {
        entries.push({
          kind: "flight",
          text: `${slice.origin} ${time(slice.departs_at)} → ${slice.destination} ${time(slice.arrives_at)}`,
          detail: `${slice.flight_numbers.join(", ")} · ${flight?.offer_id}`,
        });
      }
    }
    if (hotel && stayDated && trip.check_in === date) entries.push({ kind: "hotel", text: `Check-in · ${hotel.name}`, detail: hotel.hotel_id });
    if (hotel && stayDated && trip.check_out === date) entries.push({ kind: "hotel", text: `Check-out · ${hotel.name}`, detail: hotel.hotel_id });
    days.push({ date, label: dayLabel(index + 1, date), title: null, entries, weather: weatherOn.get(date) ?? null });
  }
  const undated = hotel && !stayDated ? [{ name: hotel.name, ref: hotel.hotel_id }] : [];
  return { days, built: false, undated };
}

const ENTRY_ICON = { flight: Plane, hotel: BedDouble, place: Landmark, note: StickyNote } as const;

export function DayTimeline({ days, undated = [] }: { days: PlanDay[]; undated?: UndatedStay[] }) {
  return (
    <>
      <ol className="flex flex-col">
        {days.map((day, index) => {
          const last = index === days.length - 1;
          const empty = day.entries.length === 0 && !day.weather;
          return (
            <li key={`${day.label}-${index}`} className="relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 pb-4 last:pb-0">
              {!last && <span aria-hidden="true" className="absolute bottom-0 left-3.5 top-8 w-px -translate-x-1/2 bg-line" />}
              <span aria-hidden="true" className="relative grid h-7 w-7 place-items-center rounded-full border border-line-strong bg-surface-2 font-mono text-[11px] text-ink">
                {index + 1}
              </span>
              <div className="min-w-0 pt-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="text-[13px] font-medium leading-5 text-ink">{day.label}</p>
                  {day.title && <p className="min-w-0 truncate text-xs leading-5 text-dim">{day.title}</p>}
                </div>
                <ul className="mt-1 flex flex-col gap-1">
                  {day.entries.map((entry, entryIndex) => {
                    const Icon = ENTRY_ICON[entry.kind];
                    return (
                      <li key={entryIndex} className="flex items-start gap-2 text-xs leading-4 text-dim">
                        <Icon size={12} aria-hidden="true" className="mt-0.5 shrink-0 text-faint" />
                        <span className="min-w-0">
                          <span className={entry.kind === "note" ? "text-dim" : "text-ink"}>{entry.text}</span>
                          {entry.detail && <span className="font-mono text-faint"> · {entry.detail}</span>}
                        </span>
                      </li>
                    );
                  })}
                  {day.weather && (
                    <li className="flex items-center gap-2 text-xs leading-4 text-dim">
                      <CloudSun size={12} aria-hidden="true" className="shrink-0 text-faint" />
                      <span className="tm-num">
                        {degrees(day.weather.temp_max_c)} / {degrees(day.weather.temp_min_c)}
                      </span>
                      <span>· rain {day.weather.precipitation_chance_pct ?? "—"}%</span>
                    </li>
                  )}
                  {empty && <li className="text-xs leading-4 text-faint">Nothing in this plan's results for this date</li>}
                </ul>
              </div>
            </li>
          );
        })}
      </ol>
      {undated.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1 border-t border-line pt-3 text-xs leading-4 text-dim">
          {undated.map((stay) => (
            <li key={stay.ref} className="flex items-start gap-2">
              <BedDouble size={12} aria-hidden="true" className="mt-0.5 shrink-0 text-faint" />
              <span>
                <span className="text-ink">{stay.name}</span>
                <span className="font-mono text-faint"> · {stay.ref}</span> · stay dates aren't in the results
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// --- budget --------------------------------------------------------------------------------

const CATEGORY_LABEL = { flights: "Flights", hotels: "Hotels" } as const;

/** The run's budget estimate as a part-to-whole ring, flagged when it includes converted prices. */
export function BudgetPanel({ budget }: { budget: AgentBudget }) {
  const currency = budget.currency;
  const single = currency !== null && budget.categories.every((c) => c.currency === currency);
  // Amounts that include a converted price keep their "≈" wherever the chart prints them.
  const convertedValues = new Set<number>([
    ...budget.categories.filter((c) => c.converted).map((c) => c.total_minor),
    ...(budget.converted && budget.total_minor !== null ? [budget.total_minor] : []),
  ]);
  return (
    <Panel
      title="Budget"
      description="Estimated from this plan's options, for all travellers"
      actions={budget.converted ? <Badge tone="info">Includes ≈ converted</Badge> : undefined}
    >
      {single ? (
        <Donut
          label="Budget by category"
          slices={budget.categories.map((c) => ({ label: CATEGORY_LABEL[c.category] ?? c.category, value: c.total_minor }))}
          valueFormat={(minor) => `${convertedValues.has(minor) ? "≈ " : ""}${formatMoney({ amount_minor: minor, currency })}`}
          center={
            <div className="flex flex-col items-center">
              <Amount formatted={budget.total_formatted ?? "—"} className="text-base text-ink" />
              <span className="tm-micro">Total</span>
            </div>
          }
        />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {budget.totals_by_currency.map((total) => (
            <li key={total.currency} className="flex items-center justify-between text-[13px]">
              <span className="text-dim">{total.currency}</span>
              <Amount formatted={total.total_formatted} className="text-ink" />
            </li>
          ))}
        </ul>
      )}
      <ul className="mt-3 flex flex-col gap-1 border-t border-line pt-3 text-xs leading-4">
        {budget.categories.map((category) => (
          <li key={`${category.category}-${category.currency}`} className="flex items-center justify-between gap-3">
            <span className="text-dim">
              {CATEGORY_LABEL[category.category] ?? category.category}
              <span className="font-mono text-faint"> · {category.items.join(", ")}</span>
            </span>
            <Amount formatted={category.total_formatted} className="text-ink" />
          </li>
        ))}
      </ul>
      {(budget.note || budget.unpriced.length > 0) && (
        <p className="mt-3 text-[11px] leading-4 text-faint">
          {[budget.note, budget.unpriced.length > 0 ? `No price for ${budget.unpriced.join(", ")}.` : null].filter(Boolean).join(" ")}
        </p>
      )}
    </Panel>
  );
}

/** Without a budget estimate: the flight options' totals side by side (same currency only). */
export function FareComparison({ flights }: { flights: AgentFlightCard[] }) {
  const currency = flights[0]?.total_currency;
  const comparable = flights.filter((f) => f.total_currency === currency);
  const cheapest = Math.min(...comparable.map((f) => f.total_minor));
  const convertedValues = new Set(comparable.filter((f) => f.converted).map((f) => f.total_minor));
  return (
    <Panel title="Price comparison" description="Each flight option's total for all travellers">
      <BarList
        label="Flight option totals"
        items={comparable.map((f) => ({
          label: `${f.offer_id} · ${f.carrier_name ?? f.carrier}`,
          value: f.total_minor,
          hint: [f.converted ? "converted" : null, f.total_minor === cheapest ? "lowest" : null, f.stops === 0 ? "nonstop" : `${f.stops} stop${f.stops > 1 ? "s" : ""}`]
            .filter(Boolean)
            .join(" · "),
        }))}
        valueFormat={(minor) => `${convertedValues.has(minor) ? "≈ " : ""}${formatMoney({ amount_minor: minor, currency: currency ?? "INR" })}`}
      />
      <p className="mt-3 text-[11px] leading-4 text-faint">
        Ask for a budget estimate to add hotels and a single trip total.
      </p>
    </Panel>
  );
}


