import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ChartLine, CircleDashed } from "lucide-react";
import type { Cabin } from "../../api/offers";
import { routeIntelQueryOptions, type RouteIntel } from "../../api/routeIntel";
import { useCurrentUser } from "../../auth/useCurrentUser";
import { useClock } from "../../shell/useClock";
import { KpiStrip, KpiTile } from "../../ui/charts";
import { PageHeader } from "../../ui/PageHeader";
import { Panel } from "../../ui/Panel";
import { Skeleton } from "../../ui/Skeleton";
import { PanelError } from "../command/PanelError";
import { CarriersPanel, DaysOutPanel, FamilyBadge, RouteFigures, ScanFaresLink, SearchesPanel, TrendPanel } from "./RoutePanels";
import { RoutePicker } from "./RoutePicker";
import { RouteSuggestions } from "./RouteSuggestions";
import { routeName, WINDOW_DAYS } from "./routeFacts";

const DESCRIPTION = `What a route has cost over the last ${WINDOW_DAYS} days, from recorded fares and your own searches.`;
const EMPTY_COPY = "No fares seen on this route yet — scan fares to start its history.";

type Route = { origin?: string; destination?: string; cabin?: Cabin };

const ABOUT = [
  "The daily median fare with its typical range: the middle half of each day's fares",
  "Medians by how far before departure the fare was seen, and the cheapest window",
  "The carriers seen most often and their median fares",
  "Your agency's own recent searches of the route",
  "Market fares (live or cached) when the route has any; otherwise sandbox fares, labelled as demonstration data",
];

function AboutPanel() {
  return (
    <Panel title="What route intel shows" description={`One traveller, one way, over the last ${WINDOW_DAYS} days in the route's currency`}>
      <ul className="flex flex-col">
        {ABOUT.map((item) => (
          <li key={item} className="flex items-start gap-2.5 border-t border-line py-2.5 first:border-t-0 first:pt-0 last:pb-0">
            <ChartLine size={14} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-faint" />
            <span className="text-[13px] leading-5 text-ink">{item}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function LoadingRoute() {
  return (
    <div aria-busy="true">
      <span className="sr-only">Loading route figures…</span>
      <KpiStrip label="Route figures" columns={5} busy className="mb-4">
        {["Median now", "Typical range", "Fares seen", "Best time to book", "Last updated"].map((label) => (
          <KpiTile key={label} label={label} value="" loading />
        ))}
      </KpiStrip>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(19rem,1fr)]">
        <Panel title="Daily median fare">
          <Skeleton className="h-60 w-full" />
        </Panel>
        <Panel title="By days before departure">
          <Skeleton lines={5} />
        </Panel>
      </div>
    </div>
  );
}

function EmptyRoute({ intel, cabin, onPick }: { intel: RouteIntel; cabin: Cabin; onPick: (o: string, d: string) => void }) {
  const now = useClock(60_000);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(19rem,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <section
          aria-label="Fare history"
          className="flex flex-col items-center gap-3 rounded-lg border border-line bg-surface px-4 py-10 text-center"
        >
          <span aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-lg border border-line bg-surface-2 text-dim">
            <CircleDashed size={18} strokeWidth={1.75} />
          </span>
          <div className="flex max-w-md flex-col gap-1">
            <p className="text-sm font-semibold text-ink">No fare history for {routeName(intel.origin, intel.destination)}</p>
            <p className="text-[13px] leading-5 text-dim">{EMPTY_COPY}</p>
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-3">
            <ScanFaresLink intel={intel} cabin={cabin} />
            <Link to="/app/fares" className="rounded-sm text-[13px] font-medium text-primary underline-offset-2 hover:underline">
              Fare search
            </Link>
          </div>
        </section>
        <RouteSuggestions onPick={onPick} exclude={`${intel.origin}-${intel.destination}`} />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {intel.your_searches.length > 0 && <SearchesPanel intel={intel} cabin={cabin} now={now} />}
        <AboutPanel />
      </div>
    </div>
  );
}

function RouteView({ intel, cabin, timeZone }: { intel: RouteIntel; cabin: Cabin; timeZone: string }) {
  const now = useClock(60_000);
  return (
    <>
      <RouteFigures intel={intel} timeZone={timeZone} now={now} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(19rem,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <TrendPanel intel={intel} />
          <CarriersPanel intel={intel} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <DaysOutPanel intel={intel} />
          <SearchesPanel intel={intel} cabin={cabin} now={now} />
        </div>
      </div>
    </>
  );
}

/** Route intelligence: pick a route, then read what it has cost lately and how the agency searched it. */
export function RouteIntelPage() {
  const search = useSearch({ from: "/app/routes" });
  const navigate = useNavigate({ from: "/app/routes" });
  const me = useCurrentUser();
  const cabin = search.cabin ?? "economy";
  const intel = useQuery(routeIntelQueryOptions({ origin: search.origin, destination: search.destination, cabin }));
  const ready = Boolean(search.origin && search.destination);

  const go = (next: Route) =>
    void navigate({
      search: {
        origin: next.origin || undefined,
        destination: next.destination && next.destination !== next.origin ? next.destination : undefined,
        cabin: next.cabin ?? cabin,
      },
    });
  const pick = (origin: string, destination: string) => go({ origin, destination, cabin });

  const data = ready ? intel.data : undefined;
  return (
    <>
      <PageHeader
        title="Route intel"
        description={DESCRIPTION}
        meta={data ? <FamilyBadge family={data.family} /> : undefined}
        actions={data && data.family ? <ScanFaresLink intel={data} cabin={cabin} /> : undefined}
      />
      <RoutePicker origin={search.origin} destination={search.destination} cabin={cabin} onChange={go} />
      {!ready ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(19rem,1fr)]">
          <RouteSuggestions onPick={pick} />
          <AboutPanel />
        </div>
      ) : intel.isError ? (
        <PanelError error={intel.error} onRetry={() => void intel.refetch()} retrying={intel.isFetching} />
      ) : !data ? (
        <LoadingRoute />
      ) : data.family === null ? (
        <EmptyRoute intel={data} cabin={cabin} onPick={pick} />
      ) : (
        <RouteView intel={data} cabin={cabin} timeZone={me?.agency.timezone ?? "UTC"} />
      )}
    </>
  );
}
