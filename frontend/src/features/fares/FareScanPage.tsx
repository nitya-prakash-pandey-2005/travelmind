import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CircleAlert, Plane } from "lucide-react";
import { useId, useState } from "react";
import { asApiError } from "../../api/client";
import type { FlightOffer, FlightSearchRequest, FlightSearchResponse } from "../../api/offers";
import { flightSearchQueryOptions } from "../../api/queries";
import { useCurrentUser } from "../../auth/useCurrentUser";
import { formatDuration, formatNumber } from "../../lib/format";
import { formatMoney } from "../../lib/money";
import { buttonClasses } from "../../ui/Button";
import { cn } from "../../ui/cn";
import { EmptyState } from "../../ui/EmptyState";
import { PageHeader } from "../../ui/PageHeader";
import { Skeleton } from "../../ui/Skeleton";
import { FareInsight } from "./FareInsight";
import { CABINS, FareSearchForm } from "./FareSearchForm";
import { OfferCard } from "./OfferCard";
import { QuickRoutes } from "./QuickRoutes";
import { FARE_GUIDE, FARE_NOTE } from "./guides";
import { ReadingGuide } from "./ReadingGuide";
import { SourceStrip } from "./SourceStrip";
import { sortOffers, type SortMode } from "./sortOffers";
import { SupplierStatusCard } from "./SupplierStatusCard";
import { useRecentRoutes } from "../route/recentRoutes";
import { routeStore } from "../route/routeStore";

const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** "2026-11-20" → "Fri 20 Nov". */
function tripDay(date: string): string {
  return DAY.format(new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))));
}

/** "DEL → BOM · Fri 20 Nov – Sun 22 Nov · 2 adults · Economy" */
function tripSummary(request: FlightSearchRequest): string {
  const dates = request.return_date
    ? `${tripDay(request.departure_date)} – ${tripDay(request.return_date)}`
    : `${tripDay(request.departure_date)} · one way`;
  const cabin = CABINS.find((c) => c.value === request.cabin)?.label ?? request.cabin;
  return `${request.origin} → ${request.destination} · ${dates} · ${request.adults} adult${request.adults === 1 ? "" : "s"} · ${cabin}`;
}

/** The best value each sort would put first, shown beside its label (e.g. "Fastest 2h 10m"). */
function bestOf(offers: FlightOffer[], displayCurrency: string): Record<SortMode, string | null> {
  const min = (values: (number | null)[]) => {
    const known = values.filter((v): v is number => v !== null);
    return known.length > 0 ? Math.min(...known) : null;
  };
  const price = min(offers.map((o) => (o.display_total?.currency === displayCurrency ? o.display_total.amount_minor : null)));
  const duration = min(offers.map((o) => o.total_duration_minutes));
  const co2 = min(offers.map((o) => o.co2_kg_per_passenger));
  return {
    price: price !== null ? formatMoney({ amount_minor: price, currency: displayCurrency }) : null,
    duration: duration !== null ? formatDuration(duration) : null,
    co2: co2 !== null ? `${formatNumber(co2)} kg` : null,
  };
}

const SORTS: { mode: SortMode; label: string }[] = [
  { mode: "price", label: "Cheapest" },
  { mode: "duration", label: "Fastest" },
  { mode: "co2", label: "Greenest" },
];

function SortTabs({ value, onChange, data }: { value: SortMode; onChange: (mode: SortMode) => void; data: FlightSearchResponse }) {
  const id = useId();
  const best = bestOf(data.offers, data.display_currency);
  return (
    <div
      role="group"
      aria-label="Sort offers"
      className="inline-flex max-w-full items-stretch rounded-md border border-line-strong bg-surface-2 p-0.5"
    >
      {SORTS.map(({ mode, label }) => {
        const selected = value === mode;
        const hint = best[mode];
        return (
          <button
            key={mode}
            type="button"
            aria-pressed={selected}
            aria-describedby={hint ? `${id}-${mode}` : undefined}
            onClick={() => onChange(mode)}
            className={cn(
              "flex min-w-0 flex-1 flex-col items-start rounded-[4px] border px-3 py-1 text-left transition-colors duration-150 ease-tm sm:min-w-28",
              selected
                ? "border-line-strong bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.2)]"
                : "border-transparent text-dim hover:text-ink",
            )}
          >
            <span className="text-xs font-medium leading-4">{label}</span>
            {hint && (
              <span id={`${id}-${mode}`} aria-hidden="true" className="tm-num truncate text-[11px] leading-4 text-dim">
                {hint}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function Searching() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
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
          <Skeleton className="mt-6 h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

export function FareScanPage() {
  const me = useCurrentUser();
  const recent = useRecentRoutes(me?.user.id ?? "anonymous");
  const [request, setRequest] = useState<FlightSearchRequest | null>(null);
  const [sort, setSort] = useState<SortMode>("price");
  const search = useQuery(flightSearchQueryOptions(request));
  const data = search.data;
  // Fare insight only plots a fare the server compared with the baseline (it has an insight), per
  // traveller, like the history: offers[0] may be a sandbox fare next to a market baseline, or a
  // party's total.
  const compared = data?.offers.find((o) => o.insight !== null) ?? null;
  const showResults = request !== null && !search.isFetching && !search.isError && data !== undefined;

  const submit = (next: FlightSearchRequest) => {
    const { origin, destination } = routeStore.get();
    if (origin && destination) recent.record(origin, destination);
    if (request && JSON.stringify(request) === JSON.stringify(next)) void search.refetch();
    else setRequest(next);
  };

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Workspace", to: "/app" }, { label: "Fare search" }]}
        title="Fare search"
        description="Compare fares from every connected supplier, with price history and CO₂ for each offer."
        actions={
          <Link to="/app/suppliers" className={buttonClasses({ variant: "secondary", size: "sm" })}>
            Manage suppliers
          </Link>
        }
      />
      <div className="flex flex-col gap-4">
        <FareSearchForm busy={search.isFetching} onSearch={submit} />

        {data?.baseline && !search.isError && (
          <FareInsight baseline={data.baseline} price={compared?.per_traveller ?? null} insight={compared?.insight ?? null} />
        )}

        {request === null ? (
          // Wide screens: quick routes over the guide, supplier status beside both. Laptops: quick routes across
          // the top (their chips need the width), guide and supplier status side by side. Phones: one column.
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] min-[1400px]:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="min-w-0 lg:col-span-2 min-[1400px]:col-span-1">
              <QuickRoutes recent={recent.routes} />
            </div>
            <ReadingGuide sections={FARE_GUIDE} note={FARE_NOTE} />
            <div className="min-w-0 min-[1400px]:col-start-2 min-[1400px]:row-span-2 min-[1400px]:row-start-1">
              <SupplierStatusCard
                booking="flights"
                bookingTitle="Flight suppliers"
                services={["emissions", "price_history", "exchange_rates"]}
              />
            </div>
          </div>
        ) : (
          <section aria-labelledby="fare-results" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <h2 id="fare-results" className="text-base font-semibold leading-6 text-ink">
                  Results
                  {showResults && (
                    <span className="tm-num ml-2 text-[13px] font-normal text-dim">
                      {data.offers.length} offer{data.offers.length === 1 ? "" : "s"}
                    </span>
                  )}
                </h2>
                {request && <p className="mt-0.5 font-mono text-xs leading-4 text-dim">{tripSummary(request)}</p>}
              </div>
              {showResults && data.offers.length > 0 && <SortTabs value={sort} onChange={setSort} data={data} />}
            </div>

            {search.isFetching ? (
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
                {data.offers.length === 0 ? (
                  <div className="rounded-lg border border-line bg-surface">
                    <EmptyState
                      icon={Plane}
                      title="No offers for this route and date."
                      description="Try another date, or check which suppliers are connected."
                      action={{ label: "Check suppliers", to: "/app/suppliers" }}
                    />
                  </div>
                ) : (
                  <>
                    <ol aria-label="Flight offers" className="flex flex-col gap-2">
                      {sortOffers(data.offers, sort).map((offer) => (
                        <li key={offer.id}>
                          <OfferCard offer={offer} />
                        </li>
                      ))}
                    </ol>
                    <div className="flex flex-col gap-1 text-xs leading-4 text-faint">
                      <p>Prices in {data.display_currency} for all travellers, including taxes and fees.</p>
                      {data.fx_as_of && (
                        <p>
                          ≈ prices converted with ECB reference rates of {data.fx_as_of}; you are billed in the supplier's currency.
                        </p>
                      )}
                      {data.offers.some((o) => o.co2_source?.startsWith("google_tim")) && (
                        <p>CO₂ per passenger: Google Travel Impact Model (CC BY-SA 4.0).</p>
                      )}
                    </div>
                  </>
                )}
              </>
            ) : null}
          </section>
        )}
      </div>
    </>
  );
}
