import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BedDouble, Building2, CircleAlert, PlugZap, Search, Star } from "lucide-react";
import { useState } from "react";
import { asApiError } from "../../api/client";
import type { HotelOffer, HotelSearchRequest } from "../../api/offers";
import { hotelSearchQueryOptions } from "../../api/queries";
import type { Airport } from "../../api/types";
import { isoDateFromNow } from "../../lib/dates";
import { clampGuests } from "../../lib/guests";
import { formatMoney } from "../../lib/money";
import { Button, buttonClasses } from "../../ui/Button";
import { cn } from "../../ui/cn";
import { EmptyState } from "../../ui/EmptyState";
import { PageHeader } from "../../ui/PageHeader";
import { ProvenanceBadge } from "../../ui/ProvenanceBadge";
import { Skeleton } from "../../ui/Skeleton";
import { TextField } from "../../ui/TextField";
import { AirportPicker } from "../airports/AirportPicker";
import { SourceStrip } from "../fares/SourceStrip";
import { routeStore } from "../route/routeStore";

/** Adults per room (the field's max). */
const MAX_ADULTS = 6;

const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** "2026-11-20" → "Fri 20 Nov". */
function stayDay(date: string): string {
  return DAY.format(new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))));
}

/** "Near BOM · Fri 20 Nov – Sun 22 Nov · 2 adults, 1 room" */
function stayLine(request: HotelSearchRequest): string {
  const adults = request.rooms[0]?.adults ?? 1;
  return `Near ${request.destination} · ${stayDay(request.checkin)} – ${stayDay(request.checkout)} · ${adults} adult${adults === 1 ? "" : "s"}, 1 room`;
}

function cancellationTerms(offer: HotelOffer): string {
  if (offer.refundable === true) {
    return offer.free_cancellation_until ? `Free cancellation until ${offer.free_cancellation_until}` : "Refundable";
  }
  return offer.refundable === false ? "Non-refundable" : "Cancellation terms on request";
}

function Stars({ count }: { count: number }) {
  const whole = Math.max(1, Math.floor(count));
  return (
    <span className="inline-flex items-center gap-px text-warn">
      {Array.from({ length: whole }, (_, index) => (
        <Star key={index} size={11} aria-hidden="true" className="fill-current" strokeWidth={0} />
      ))}
      <span className="sr-only">{`${count}-star hotel`}</span>
    </span>
  );
}

function HotelCard({ offer }: { offer: HotelOffer }) {
  const shown = offer.display_total ?? offer.total;
  const converted = offer.display_total !== null && offer.display_total.currency !== offer.total.currency;
  const approx = converted ? "≈ " : "";
  const price = formatMoney(shown);
  const perNight = formatMoney({ amount_minor: Math.round(shown.amount_minor / offer.nights), currency: shown.currency });
  const terms = cancellationTerms(offer);
  return (
    <article
      aria-label={converted ? `${offer.name} about ${price}` : `${offer.name} ${price}`}
      className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-3 rounded-lg border border-line bg-surface p-3 transition-colors duration-150 ease-tm hover:border-line-strong sm:grid-cols-[9rem_minmax(0,1fr)_auto]"
    >
      <div
        className={cn(
          "col-span-2 aspect-[16/9] overflow-hidden rounded-md border border-line bg-surface-2 sm:col-span-1 sm:row-span-2 sm:aspect-[4/3]",
          // Without a photo, phones skip the placeholder rather than spend a screen's width on an icon.
          !offer.photo_url && "max-sm:hidden",
        )}
      >
        {offer.photo_url ? (
          <img src={offer.photo_url} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span aria-hidden="true" className="grid h-full w-full place-items-center text-faint">
            <Building2 size={22} strokeWidth={1.5} />
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <p className="break-words text-sm font-medium leading-5 text-ink">{offer.name}</p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-4 text-dim">
          {offer.stars ? <Stars count={offer.stars} /> : null}
          {offer.rating !== null ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="tm-num rounded-[4px] border border-line-strong bg-surface-2 px-1 text-[11px] font-semibold text-ink">
                {offer.rating.toFixed(1)}
              </span>
              Guest rating
            </span>
          ) : (
            <span>No rating yet</span>
          )}
        </p>
        {offer.address && <p className="break-words text-xs leading-4 text-faint">{offer.address}</p>}
        <p className="mt-1 flex items-start gap-1.5 text-[13px] leading-5 text-dim">
          <BedDouble size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-faint" />
          <span className="min-w-0 break-words">{[offer.room_name, offer.board].filter(Boolean).join(" · ") || "Room details on request"}</span>
        </p>
      </div>

      <div className="flex flex-col items-end gap-0.5 text-right">
        <p className="text-xs leading-4 text-dim">
          <span className="tm-num block text-xl font-semibold leading-7 text-ink">{`${approx}${perNight}`}</span>
          {" "}/ night
        </p>
        <p className="tm-num text-xs leading-4 text-dim">{`${approx}${price} for ${offer.nights} night${offer.nights === 1 ? "" : "s"}`}</p>
        {converted && <p className="text-xs leading-4 text-dim">Billed {formatMoney(offer.total)}</p>}
      </div>

      <div className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-2.5 text-xs leading-4 sm:col-span-2 sm:col-start-2">
        <ProvenanceBadge provenance={offer.provenance} />
        <span className={cn(offer.refundable === true ? "text-ok" : offer.refundable === false ? "text-dim" : "text-faint")}>
          {terms}
        </span>
      </div>
    </article>
  );
}

function Searching() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <p role="status" className="flex items-center gap-2 text-[13px] text-dim">
        <span aria-hidden="true" className="tm-live h-1.5 w-1.5 rounded-full bg-primary" />
        Searching hotels…
      </p>
      {[0, 1, 2].map((index) => (
        <div key={index} aria-hidden="true" className="grid grid-cols-[9rem_minmax(0,1fr)_auto] gap-6 rounded-lg border border-line bg-surface p-3">
          <Skeleton className="aspect-[4/3] h-auto" />
          <Skeleton lines={3} />
          <Skeleton className="h-7 w-24" />
        </div>
      ))}
    </div>
  );
}

export function HotelScanPage() {
  const [destination, setDestination] = useState<Airport | null>(() => routeStore.get().destination);
  const [checkin, setCheckin] = useState(() => isoDateFromNow(14));
  const [checkout, setCheckout] = useState(() => isoDateFromNow(16));
  // A draft string so the field can be cleared and retyped; it is clamped on blur and on submit.
  const [adults, setAdults] = useState("2");
  const [request, setRequest] = useState<HotelSearchRequest | null>(null);
  const search = useQuery(hotelSearchQueryOptions(request));
  const checkinInPast = checkin !== "" && checkin < isoDateFromNow(0);
  const badDates = checkin !== "" && checkout !== "" && checkout <= checkin;
  const ready = destination !== null && checkin !== "" && checkout !== "" && !checkinInPast && !badDates;
  const data = search.data;
  const notConfigured = data?.sources.find((s) => s.status === "not_configured");
  const showResults = request !== null && !search.isFetching && !search.isError && data !== undefined;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Workspace", to: "/app" }, { label: "Hotel search" }]}
        title="Hotel search"
        description="Rooms near an airport from every connected hotel supplier, with board and cancellation terms."
        actions={
          <Link to="/app/suppliers" className={buttonClasses({ variant: "secondary", size: "sm" })}>
            Manage suppliers
          </Link>
        }
      />
      <div className="flex flex-col gap-4">
        <form
          aria-label="Search hotels"
          className="rounded-lg border border-line bg-surface p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready || !destination) return;
            const guests = clampGuests(adults, MAX_ADULTS);
            setAdults(String(guests));
            const next = { destination: destination.iata_code, checkin, checkout, rooms: [{ adults: guests, children_ages: [] }] };
            if (request && JSON.stringify(request) === JSON.stringify(next)) void search.refetch();
            else setRequest(next);
          }}
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
            <div className="min-w-0 lg:flex-1">
              <AirportPicker label="Near" value={destination} onChange={setDestination} />
            </div>
            <div className="grid min-w-0 grid-cols-2 items-start gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6rem] lg:flex-[1.2]">
              <TextField
                label="Check-in"
                type="date"
                required
                min={isoDateFromNow(0)}
                value={checkin}
                error={checkinInPast ? "Check-in can't be in the past." : undefined}
                onChange={(e) => setCheckin(e.target.value)}
              />
              <TextField
                label="Check-out"
                type="date"
                required
                min={checkin}
                value={checkout}
                error={badDates ? "Check-out must be after check-in." : undefined}
                onChange={(e) => setCheckout(e.target.value)}
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
            </div>
            {/* 26px = a field label (20px) and its gap (6px): lines the button up with the inputs beside it. */}
            <Button
              type="submit"
              disabled={!ready}
              loading={search.isFetching}
              className="w-full sm:w-auto sm:self-end lg:mt-[26px] lg:self-start"
            >
              {!search.isFetching && <Search size={15} aria-hidden="true" />}
              Scan hotels
            </Button>
          </div>
        </form>

        <section aria-labelledby="hotel-results" className="flex flex-col gap-3">
          <div className="min-w-0">
            <h2 id="hotel-results" className="text-base font-semibold leading-6 text-ink">
              Results
              {showResults && (
                <span className="tm-num ml-2 text-[13px] font-normal text-dim">
                  {data.offers.length} hotel{data.offers.length === 1 ? "" : "s"}
                </span>
              )}
            </h2>
            {request && (
              <p className="mt-0.5 font-mono text-xs leading-4 text-dim">
                {stayLine(request)}
              </p>
            )}
          </div>

          {request === null ? (
            <div className="rounded-lg border border-line bg-surface">
              <EmptyState
                icon={BedDouble}
                title="Search to see rooms"
                description="Choose an airport and your dates. Rooms from every connected hotel supplier appear here."
              />
            </div>
          ) : search.isFetching ? (
            <Searching />
          ) : search.isError ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-[13px] leading-5 text-danger"
            >
              <CircleAlert size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
              {asApiError(search.error).message}
            </p>
          ) : data ? (
            <>
              <SourceStrip sources={data.sources} />
              {notConfigured && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line bg-surface px-4 py-3">
                  <PlugZap size={16} aria-hidden="true" className="shrink-0 text-warn" />
                  <p className="min-w-0 flex-1 text-[13px] leading-5 text-ink">{notConfigured.message}</p>
                  <Link to="/app/suppliers" className={buttonClasses({ variant: "secondary", size: "sm" })}>
                    Open suppliers
                  </Link>
                </div>
              )}
              {data.offers.length > 0 ? (
                <>
                  <ol aria-label="Hotel offers" className="flex flex-col gap-2">
                    {data.offers.map((offer) => (
                      <li key={offer.id}>
                        <HotelCard offer={offer} />
                      </li>
                    ))}
                  </ol>
                  <div className="flex flex-col gap-1 text-xs leading-4 text-faint">
                    <p>Totals in {data.display_currency} for the whole stay.</p>
                    {data.fx_as_of && (
                      <p>
                        ≈ prices converted with ECB reference rates of {data.fx_as_of}; you are billed in the supplier's currency.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                !notConfigured && (
                  <div className="rounded-lg border border-line bg-surface">
                    <EmptyState
                      icon={BedDouble}
                      title="No rooms for these dates."
                      description="Try other dates or a nearby airport."
                    />
                  </div>
                )
              )}
            </>
          ) : null}
        </section>
      </div>
    </>
  );
}
