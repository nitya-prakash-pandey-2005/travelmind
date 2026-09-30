import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { asApiError } from "../../api/client";
import type { HotelOffer, HotelSearchRequest } from "../../api/offers";
import { hotelSearchQueryOptions } from "../../api/queries";
import type { Airport } from "../../api/types";
import { isoDateFromNow } from "../../lib/dates";
import { clampGuests } from "../../lib/guests";
import { formatMoney } from "../../lib/money";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Panel } from "../../ui/Panel";
import { PROVENANCE } from "../../ui/provenance";
import { TextField } from "../../ui/TextField";
import { AirportPicker } from "../airports/AirportPicker";
import { SourceStrip } from "../fares/SourceStrip";
import { routeStore } from "../route/routeStore";

/** Adults per room (the field's max). */
const MAX_ADULTS = 6;

function cancellationTerms(offer: HotelOffer): string {
  if (offer.refundable === true) {
    return offer.free_cancellation_until ? `Free cancellation until ${offer.free_cancellation_until}` : "Refundable";
  }
  return offer.refundable === false ? "Non-refundable" : "Cancellation terms on request";
}

function HotelCard({ offer }: { offer: HotelOffer }) {
  const shown = offer.display_total ?? offer.total;
  const converted = offer.display_total !== null && offer.display_total.currency !== offer.total.currency;
  const approx = converted ? "≈ " : "";
  const price = formatMoney(shown);
  const perNight = formatMoney({ amount_minor: Math.round(shown.amount_minor / offer.nights), currency: shown.currency });
  return (
    <article
      aria-label={converted ? `${offer.name} about ${price}` : `${offer.name} ${price}`}
      className="flex flex-col gap-4 rounded-sm border border-line bg-void/40 p-4 sm:flex-row"
    >
      {offer.photo_url && (
        <img src={offer.photo_url} alt="" loading="lazy" className="h-32 w-full shrink-0 rounded-sm object-cover sm:h-24 sm:w-32" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="break-words text-ink">{offer.name}</p>
            <p className="text-xs text-dim">
              {offer.stars ? (
                <>
                  <span aria-hidden="true" className="text-warn">
                    {"★".repeat(Math.max(1, Math.floor(offer.stars)))}
                  </span>
                  <span className="sr-only">{`${offer.stars}-star hotel`}</span>
                  {" · "}
                </>
              ) : null}
              {offer.rating !== null ? `Guest rating ${offer.rating.toFixed(1)}` : "No rating yet"}
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-2xl text-ink">{`${approx}${price}`}</p>
            <p className="text-xs text-dim">{`${approx}${perNight} / night`}</p>
            {converted && <p className="text-xs text-dim">Billed {formatMoney(offer.total)}</p>}
          </div>
        </div>
        <p className="text-sm text-dim">{[offer.room_name, offer.board].filter(Boolean).join(" · ")}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-dim">
          <Badge tone={PROVENANCE[offer.provenance].tone}>{PROVENANCE[offer.provenance].label}</Badge>
          <span>{cancellationTerms(offer)}</span>
        </div>
        {offer.address && <p className="break-words text-[11px] text-dim">{offer.address}</p>}
      </div>
    </article>
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
  const notConfigured = search.data?.sources.find((s) => s.status === "not_configured");

  return (
    <div className="grid gap-4 xl:grid-cols-[24rem_minmax(0,1fr)]">
      <Panel eyebrow="Hotel scan" title="Find a stay">
        <form
          className="flex flex-col gap-3"
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
          <AirportPicker label="Near" value={destination} onChange={setDestination} />
          <div className="grid gap-3 sm:grid-cols-2">
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
          </div>
          <TextField
            label="Adults"
            type="number"
            min={1}
            max={MAX_ADULTS}
            value={adults}
            onChange={(e) => setAdults(e.target.value)}
            onBlur={() => setAdults(String(clampGuests(adults, MAX_ADULTS)))}
          />
          <Button type="submit" disabled={!ready} loading={search.isFetching}>
            Scan hotels
          </Button>
        </form>
      </Panel>
      <Panel eyebrow="Stays" title="Hotel board">
        {request === null ? (
          <p className="text-sm text-dim">Choose where and when, then scan for rooms.</p>
        ) : search.isFetching ? (
          <p role="status" className="tm-blink font-mono text-xs uppercase tracking-[0.2em] text-primary">
            Scanning hotels…
          </p>
        ) : search.isError ? (
          <p role="alert" className="text-sm text-danger">
            {asApiError(search.error).message}
          </p>
        ) : search.data ? (
          <div className="flex flex-col gap-3">
            <SourceStrip sources={search.data.sources} />
            {notConfigured && (
              <div className="flex flex-col items-start gap-2">
                <p className="text-sm text-ink">{notConfigured.message}</p>
                <Link to="/app/suppliers" className="text-sm text-primary underline underline-offset-4">
                  Open suppliers
                </Link>
              </div>
            )}
            {search.data.offers.length > 0 ? (
              <>
                <ol aria-label="Hotel offers" className="flex flex-col gap-3">
                  {search.data.offers.map((offer) => (
                    <li key={offer.id}>
                      <HotelCard offer={offer} />
                    </li>
                  ))}
                </ol>
                {search.data.fx_as_of && (
                  <p className="text-[11px] text-dim">
                    ≈ prices converted with ECB reference rates of {search.data.fx_as_of}; you are billed in the supplier's currency.
                  </p>
                )}
              </>
            ) : (
              !notConfigured && <p className="text-sm text-dim">No rooms for these dates.</p>
            )}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
