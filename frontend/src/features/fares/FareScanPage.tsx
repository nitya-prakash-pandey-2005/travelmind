import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { asApiError } from "../../api/client";
import type { FlightSearchRequest } from "../../api/offers";
import { flightSearchQueryOptions } from "../../api/queries";
import { cn } from "../../ui/cn";
import { Panel } from "../../ui/Panel";
import { FareGauge } from "./FareGauge";
import { FareSearchForm } from "./FareSearchForm";
import { OfferCard } from "./OfferCard";
import { SourceStrip } from "./SourceStrip";
import { sortOffers, type SortMode } from "./sortOffers";

const SORTS: { mode: SortMode; label: string }[] = [
  { mode: "price", label: "Cheapest" },
  { mode: "duration", label: "Fastest" },
  { mode: "co2", label: "Greenest" },
];

export function FareScanPage() {
  const [request, setRequest] = useState<FlightSearchRequest | null>(null);
  const [sort, setSort] = useState<SortMode>("price");
  const search = useQuery(flightSearchQueryOptions(request));
  const data = search.data;
  const cheapest = data?.offers[0] ?? null;

  const submit = (next: FlightSearchRequest) => {
    if (request && JSON.stringify(request) === JSON.stringify(next)) void search.refetch();
    else setRequest(next);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[24rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <FareSearchForm busy={search.isFetching} onSearch={submit} />
        {data?.baseline && !search.isError && (
          <FareGauge baseline={data.baseline} price={cheapest?.display_total ?? null} insight={cheapest?.insight ?? null} />
        )}
      </div>
      <Panel eyebrow="Offers" title="Fare board">
        {request === null ? (
          <p className="text-sm text-dim">Pick a route and scan to see offers from every connected supplier.</p>
        ) : search.isFetching ? (
          <p role="status" className="tm-blink font-mono text-xs uppercase tracking-[0.2em] text-primary">
            Scanning suppliers…
          </p>
        ) : search.isError ? (
          <p role="alert" className="text-sm text-danger">
            {asApiError(search.error).message}
          </p>
        ) : data ? (
          <div className="flex flex-col gap-3">
            <SourceStrip sources={data.sources} />
            {data.offers.length === 0 ? (
              <p className="text-sm text-dim">No offers for this route and date.</p>
            ) : (
              <>
                <div role="group" aria-label="Sort offers" className="flex flex-wrap gap-2">
                  {SORTS.map(({ mode, label }) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={sort === mode}
                      onClick={() => setSort(mode)}
                      className={cn(
                        "h-8 rounded-sm border px-3 font-display text-xs uppercase tracking-[0.14em] transition",
                        sort === mode ? "border-primary text-primary" : "border-line text-dim hover:text-ink",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <ol aria-label="Flight offers" className="flex flex-col gap-3">
                  {sortOffers(data.offers, sort).map((offer) => (
                    <li key={offer.id}>
                      <OfferCard offer={offer} />
                    </li>
                  ))}
                </ol>
                {data.offers.some((o) => o.co2_source?.startsWith("google_tim")) && (
                  <p className="text-[11px] text-dim">
                    CO₂ per passenger: Google Travel Impact Model (CC BY-SA 4.0).
                  </p>
                )}
                {data.fx_as_of && (
                  <p className="text-[11px] text-dim">
                    ≈ prices converted with ECB reference rates of {data.fx_as_of}; you are billed in the supplier's currency.
                  </p>
                )}
              </>
            )}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
