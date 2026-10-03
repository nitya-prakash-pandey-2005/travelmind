import { useQuery } from "@tanstack/react-query";
import { CircleAlert, Clock3, Layers, Plane, Search, SlidersHorizontal, Wallet } from "lucide-react";
import { useState } from "react";
import { asApiError } from "../../api/client";
import type { EnquiryOut } from "../../api/enquiries";
import type { FlightOffer, FlightSearchRequest } from "../../api/offers";
import { flightSearchQueryOptions } from "../../api/queries";
import { MAX_QUOTE_OPTIONS, type QuoteDetail } from "../../api/quotes";
import { isoDateFromNow } from "../../lib/dates";
import { formatNumber } from "../../lib/format";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Panel } from "../../ui/Panel";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Skeleton } from "../../ui/Skeleton";
import { CABINS, FareSearchForm } from "../fares/FareSearchForm";
import { validateFareSearch } from "../fares/fareSearchParams";
import { OfferCard } from "../fares/OfferCard";
import { SourceStrip } from "../fares/SourceStrip";
import { sortOffers, type SortMode } from "../fares/sortOffers";
import { usePrefilledRoute } from "../fares/usePrefilledRoute";

/** Results shown before "Show all". */
const FIRST_RESULTS = 8;
const SORTS = [
  { value: "price", label: "Cheapest" },
  { value: "duration", label: "Fastest" },
  { value: "co2", label: "Greenest" },
] as const;

/** "an INR quote", "a USD quote": the article for a currency code read letter by letter. */
export function currencyArticle(code: string): "a" | "an" {
  return "AEFHILMNORSX".includes(code.charAt(0).toUpperCase()) ? "an" : "a";
}

/** The fare search for the enquiry's trip, or null when it has no route or its date has passed. */
export function tripRequest(quote: QuoteDetail, enquiry: EnquiryOut | undefined): FlightSearchRequest | null {
  const origin = enquiry?.origin ?? quote.enquiry.origin;
  const destination = enquiry?.destination ?? quote.enquiry.destination;
  const depart = enquiry?.depart_date ?? quote.enquiry.depart_date;
  if (!origin || !destination || origin === destination || !depart || depart < isoDateFromNow(0)) return null;
  const returning = enquiry?.return_date && enquiry.return_date >= depart ? enquiry.return_date : null;
  return {
    origin,
    destination,
    departure_date: depart,
    return_date: returning,
    adults: enquiry?.adults ?? 1,
    children_ages: enquiry?.children_ages ?? [],
    cabin: validateFareSearch({ cabin: enquiry?.cabin }).cabin ?? "economy",
    max_connections: 1,
  };
}

const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const tripDay = (date: string) => DAY.format(new Date(`${date}T00:00:00Z`));

/** "DEL → BOM · Fri 20 Nov – Fri 27 Nov · 2 adults · Economy" */
function requestSummary(request: FlightSearchRequest): string {
  const dates = request.return_date ? `${tripDay(request.departure_date)} – ${tripDay(request.return_date)}` : `${tripDay(request.departure_date)} · one way`;
  const children = request.children_ages.length;
  const party = `${request.adults} adult${request.adults === 1 ? "" : "s"}${children ? ` · ${children} child${children === 1 ? "" : "ren"}` : ""}`;
  const cabin = CABINS.find((c) => c.value === request.cabin)?.label ?? request.cabin;
  return `${request.origin} → ${request.destination} · ${dates} · ${party} · ${cabin}`;
}

/** The full search form, prefilled with the trip; mounted only while the agent changes the search. */
function TripSearchForm({ trip, enquiry, busy, onSearch }: { trip: FlightSearchRequest | null; enquiry: EnquiryOut | undefined; busy: boolean; onSearch: (request: FlightSearchRequest) => void }) {
  usePrefilledRoute(trip?.origin ?? enquiry?.origin ?? undefined, trip?.destination ?? enquiry?.destination ?? undefined);
  const cabin = validateFareSearch({ cabin: enquiry?.cabin }).cabin;
  const depart = trip?.departure_date;
  return (
    <FareSearchForm
      busy={busy}
      onSearch={onSearch}
      initial={{ depart, returning: trip?.return_date ?? undefined, adults: enquiry?.adults, cabin }}
    />
  );
}

function Searching() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <p role="status" className="flex items-center gap-2 text-[13px] text-dim">
        <span aria-hidden="true" className="tm-live h-1.5 w-1.5 rounded-full bg-primary" />
        Searching suppliers…
      </p>
      {[0, 1, 2].map((index) => (
        <div key={index} aria-hidden="true" className="rounded-lg border border-line bg-surface p-4">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-6 md:grid-cols-[11rem_minmax(0,1fr)_9rem]">
            <Skeleton lines={2} />
            <Skeleton className="h-10 max-md:hidden" />
            <Skeleton className="h-7 w-24 justify-self-end" />
          </div>
        </div>
      ))}
    </div>
  );
}

function BeforeSearch({ currency }: { currency: string }) {
  const facts = [
    { icon: Wallet, title: `Billed in ${currency} only`, text: `A quote has one currency. Fares billed in another currency are shown but can't be added.` },
    { icon: Layers, title: `Up to ${MAX_QUOTE_OPTIONS} options`, text: "Give the client a choice: cheapest, fastest or most flexible." },
    { icon: Clock3, title: "Save within 30 minutes", text: "Offers are held for about half an hour after a search. Re-price before you save if prices may have moved." },
  ];
  return (
    <ul className="grid gap-3 rounded-md border border-dashed border-line-strong p-3 sm:grid-cols-3">
      {facts.map(({ icon: Icon, title, text }) => (
        <li key={title} className="flex gap-2.5">
          <Icon size={15} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-dim" />
          <div className="min-w-0">
            <p className="text-[13px] font-medium leading-5 text-ink">{title}</p>
            <p className="text-xs leading-4 text-dim">{text}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

type OfferPickerProps = {
  quote: QuoteDetail;
  enquiry: EnquiryOut | undefined;
  pickedIds: ReadonlySet<string>;
  /** Why nothing can be added (the quote is closed); null when it can. */
  lockedReason: string | null;
  /** Hold the selection still (a re-price or save is running). */
  frozen?: boolean;
  onToggle: (offer: FlightOffer, selected: boolean) => void;
  className?: string;
};

/**
 * "Find offers": the fare search for the enquiry's trip (one click, or changed in the full form), with
 * the results as offer cards the agent ticks to add to the quote. Only offers billed in the quote's
 * currency can be added, up to the option limit.
 */
export function OfferPicker({ quote, enquiry, pickedIds, lockedReason, frozen = false, onToggle, className }: OfferPickerProps) {
  const trip = tripRequest(quote, enquiry);
  const [request, setRequest] = useState<FlightSearchRequest | null>(null);
  const [editing, setEditing] = useState(false);
  const [sort, setSort] = useState<SortMode>("price");
  const [showAll, setShowAll] = useState(false);
  const search = useQuery(flightSearchQueryOptions(request));
  const data = search.data;
  const formOpen = editing || trip === null;
  const full = pickedIds.size >= MAX_QUOTE_OPTIONS;
  const currency = quote.currency;

  function run(next: FlightSearchRequest) {
    setShowAll(false);
    setEditing(false);
    if (request && JSON.stringify(request) === JSON.stringify(next)) void search.refetch();
    else setRequest(next);
  }

  function reasonFor(offer: FlightOffer): string | null {
    if (offer.total.currency !== currency) {
      return `Billed in ${offer.total.currency} — can't be added to ${currencyArticle(currency)} ${currency} quote`;
    }
    if (lockedReason) return lockedReason;
    if (full) return `Up to ${MAX_QUOTE_OPTIONS} options per version`;
    return null;
  }

  const offers = data ? sortOffers(data.offers, sort) : [];
  const shown = showAll ? offers : offers.slice(0, FIRST_RESULTS);
  const addable = data ? data.offers.filter((offer) => offer.total.currency === currency).length : 0;
  const enquiryNumber = enquiry?.number ?? quote.enquiry.number;
  const searched = request ?? trip;

  return (
    <Panel
      title="Find offers"
      description={`Live fares for ${enquiryNumber}'s trip. Tick Add to quote on up to ${MAX_QUOTE_OPTIONS} offers billed in ${currency}.`}
      className={className}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <Plane size={15} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-dim" />
            {searched ? (
              <p className="min-w-0 font-mono text-xs leading-5 text-ink">{requestSummary(searched)}</p>
            ) : (
              <p className="text-[13px] leading-5 text-dim">
                {enquiryNumber} has no route or an upcoming date yet. Set the search below.
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2 max-sm:w-full">
            {trip && (
              <Button
                variant="secondary"
                size="sm"
                aria-expanded={formOpen}
                onClick={() => setEditing((open) => !open)}
                className="max-sm:flex-1"
              >
                <SlidersHorizontal size={14} aria-hidden="true" />
                Change search
              </Button>
            )}
            {trip && (
              <Button size="sm" onClick={() => run(trip)} loading={search.isFetching} className="max-sm:flex-1">
                {!search.isFetching && <Search size={14} aria-hidden="true" />}
                Search fares
              </Button>
            )}
          </div>
        </div>

        {formOpen && <TripSearchForm trip={trip} enquiry={enquiry} busy={search.isFetching} onSearch={run} />}

        {request === null ? (
          <BeforeSearch currency={currency} />
        ) : search.isFetching ? (
          <Searching />
        ) : search.isError ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 px-3 py-2.5 text-[13px] leading-5 text-danger"
          >
            <CircleAlert size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
            {asApiError(search.error).message}
          </p>
        ) : data ? (
          <>
            <SourceStrip sources={data.sources} />
            {data.offers.length === 0 ? (
              <EmptyState
                icon={Plane}
                title="No offers for this route and date"
                description="Change the search to try another date, or check which suppliers are connected."
                action={{ label: "Check suppliers", to: "/app/suppliers" }}
                className="py-6"
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[13px] text-dim">
                    <span className="tm-num text-ink">{formatNumber(data.offers.length)}</span> offer{data.offers.length === 1 ? "" : "s"} ·{" "}
                    <span className="tm-num text-ink">{formatNumber(addable)}</span> billed in {currency} ·{" "}
                    <span className="tm-num text-ink">{pickedIds.size}</span>/{MAX_QUOTE_OPTIONS} selected
                  </p>
                  <SegmentedControl label="Sort offers" options={SORTS} value={sort} onChange={setSort} />
                </div>
                <ol aria-label="Flight offers" className="flex flex-col gap-2">
                  {shown.map((offer) => (
                    <li key={offer.id}>
                      <OfferCard
                        offer={offer}
                        selectable={{
                          selected: pickedIds.has(offer.id),
                          onChange: (selected) => onToggle(offer, selected),
                          disabledReason: reasonFor(offer),
                          frozen,
                        }}
                      />
                    </li>
                  ))}
                </ol>
                {offers.length > shown.length && (
                  <Button variant="secondary" size="sm" className="self-center" onClick={() => setShowAll(true)}>
                    Show all {formatNumber(offers.length)} offers
                  </Button>
                )}
                <p className="text-xs leading-4 text-faint">
                  Prices for all travellers, including taxes. ≈ amounts are converted for comparison; the quote uses each
                  supplier's billed fare.
                </p>
              </>
            )}
          </>
        ) : null}
      </div>
    </Panel>
  );
}
