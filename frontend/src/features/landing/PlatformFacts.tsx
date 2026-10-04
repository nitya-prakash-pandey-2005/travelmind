import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../../api/client";
import { connectedSuppliers, platformApi, platformFactsQueryOptions, type PlatformFacts as Facts } from "../../api/platform";
import { cn } from "../../ui/cn";
import { formatNumber } from "../../lib/format";
import { Kicker } from "./Kicker";
import { CONTAINER, SECTION_LEAD, SECTION_TITLE, SECTION_Y } from "./layout";
import { RoutesGlobe } from "./RoutesGlobe";

/** Live figures get this long to arrive; after that the band shows only what is true by construction. */
export const FACTS_DEADLINE_MS = 6_000;

/** Asks for the facts, but gives up (and lets the live row go) after FACTS_DEADLINE_MS. */
function factsWithinDeadline({ signal }: { signal: AbortSignal }) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal.addEventListener("abort", stop, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ApiError(0, "Platform facts took too long."));
    }, FACTS_DEADLINE_MS);
  });
  return Promise.race([platformApi.facts(controller.signal), deadline]).finally(() => {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  });
}

type Fact = { value: string; label: string; note: string; live?: boolean };

/**
 * Facts that hold because of how the product is built (see IntegrationsStrip, provenance, SIGNUP_COUNTRIES,
 * the role model and the Command Center's KpiRow). The airport count is swapped for the running service's own count when it answers.
 */
function staticFacts(live: Facts | undefined): Fact[] {
  return [
    {
      value: "6",
      label: "data sources",
      note: "Flights, hotels, emissions, fare history, exchange rates and airports.",
    },
    live
      ? {
          value: formatNumber(live.airports),
          label: "airports indexed",
          note: "Counted by the running service just now.",
          live: true,
        }
      : {
          value: "8,800+",
          label: "airports",
          note: "Searchable by city, airport name or IATA code.",
        },
    {
      value: "3",
      label: "price labels",
      note: "Live, Cached or Sandbox on every fare and hotel rate.",
    },
    {
      value: "2",
      label: "workspace currencies",
      note: "INR and USD. Converted amounts are marked with ≈.",
    },
    {
      value: "3",
      label: "roles",
      note: "Owner, admin and agent, set per teammate.",
    },
    {
      value: "7",
      label: "key figures",
      note: "Enquiries, quotes, win rate, pipeline, response time, CO₂ and searches.",
    },
  ];
}

const plural = (count: number, one: string, many: string) => `${formatNumber(count)} ${count === 1 ? one : many}`;

/**
 * Coverage band: six product facts that are always there, a live line from the platform when it answers
 * (nothing at all when it doesn't), and the popular-routes globe.
 */
export function PlatformFacts() {
  const facts = useQuery({
    ...platformFactsQueryOptions,
    queryFn: factsWithinDeadline,
    retry: false,
  });
  const live = facts.data;

  return (
    <section aria-labelledby="facts-title" className="border-b border-line">
      <div className={cn(CONTAINER, SECTION_Y, "grid gap-10 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:gap-12")}>
        <div className="flex min-w-0 flex-col">
          <Kicker>Platform</Kicker>
          <h2 id="facts-title" className={SECTION_TITLE}>
            Built on real travel data
          </h2>
          <p className={SECTION_LEAD}>
            Fares and rates come from supplier APIs, every price carries its source, and the reference data is public and named. The figures
            below describe the product itself.
          </p>
          <div className="mt-8 flex flex-1 flex-col gap-3">
            {/* Kit Stat tiles: the big Space Grotesk figure, its label, and what it means. */}
            <ul aria-label="Platform facts" className="grid flex-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-3">
              {staticFacts(live).map((fact) => (
                <li key={fact.label} className={cn("card stat flex min-w-0 flex-col px-4 py-4", fact.live && "glow")}>
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="v text-[30px] leading-9">{fact.value}</span>
                    <span className="text-[13px] font-semibold text-ink">{fact.label}</span>
                  </span>
                  <span className="mt-1.5 flex items-start gap-1.5 text-[13px] leading-5 text-dim">
                    {fact.live && <span aria-hidden="true" className="tm-live mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ok text-ok" />}
                    {fact.note}
                  </span>
                </li>
              ))}
            </ul>
            {!facts.isError && (
              <p className="card tight flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-dim">
                {live ? (
                  <>
                    <span className="flex items-center gap-2 font-medium text-ink">
                      <span aria-hidden="true" className="tm-live h-1.5 w-1.5 rounded-full bg-ok text-ok" />
                      Live from the platform
                    </span>
                    <span className="font-mono tabular-nums">
                      {plural(connectedSuppliers(live), "supplier connected", "suppliers connected")}
                    </span>
                    <span className="font-mono tabular-nums">
                      {plural(live.routes_with_history, "route with fare history", "routes with fare history")}
                    </span>
                  </>
                ) : (
                  <span className="text-faint">Checking live figures from the platform…</span>
                )}
              </p>
            )}
          </div>
        </div>
        <RoutesGlobe />
      </div>
    </section>
  );
}
