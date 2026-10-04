import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { CalendarClock, ChartLine, CircleDashed, Info } from "lucide-react";
import type { Cabin } from "../../api/offers";
import { routeIntelQueryOptions, type RouteIntel } from "../../api/routeIntel";
import { useCurrentUser } from "../../auth/useCurrentUser";
import { useClock } from "../../shell/useClock";
import { KpiStrip, KpiTile } from "../../ui/charts";
import { PageHeader } from "../../ui/PageHeader";
import { Panel } from "../../ui/Panel";
import { Skeleton } from "../../ui/Skeleton";
import { PanelError } from "../command/PanelError";
import {
  CarriersPanel,
  DaysOutPanel,
  FamilyBadge,
  FIGURES_GRID,
  figureCell,
  RouteFigures,
  ScanFaresLink,
  SearchesPanel,
  TrendPanel,
} from "./RoutePanels";
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
    <Panel title="What route intel shows" icon={Info} description={`One traveller, one way, over the last ${WINDOW_DAYS} days in the route's currency`}>
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
      <KpiStrip label="Route figures" columns={4} busy className={FIGURES_GRID}>
        {["Median now", "Typical range", "Fares seen", "Best time to book", "Last updated"].map((label, index) => (
          <div key={label} className={figureCell(index)}>
            <KpiTile label={label} value="" loading />
          </div>
        ))}
      </KpiStrip>
      <div className="grid g-12">
        <Panel title="Daily median fare" icon={ChartLine} className="span-8">
          <Skeleton className="h-60 w-full" />
        </Panel>
        <Panel title="By days before departure" icon={CalendarClock} className="span-4">
          <Skeleton lines={5} />
        </Panel>
      </div>
    </div>
  );
}

function EmptyRoute({ intel, cabin, onPick }: { intel: RouteIntel; cabin: Cabin; onPick: (o: string, d: string) => void }) {
  const now = useClock(60_000);
  return (
    <div className="grid g-12 items-start">
      <div className="span-8 flex min-w-0 flex-col gap-4">
        <section aria-label="Fare history" className="card flex flex-col items-center gap-3 px-4 py-10 text-center">
          <span aria-hidden="true" className="grid h-11 w-11 place-items-center rounded-[12px] bg-card-2 text-dim">
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
      <div className="span-4 flex min-w-0 flex-col gap-4">
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
      {/* The kit's 12-column grid: the trend beside the days-out bars, then the carriers beside your searches. */}
      <div className="grid g-12">
        <TrendPanel intel={intel} className="span-8" />
        <DaysOutPanel intel={intel} className="span-4" />
        <CarriersPanel intel={intel} className="span-7 self-start" />
        <SearchesPanel intel={intel} cabin={cabin} now={now} className="span-5" />
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
        breadcrumb={[{ label: "Workspace", to: "/app" }, { label: "Route intel" }]}
        title="Route intel"
        description={DESCRIPTION}
        meta={data ? <FamilyBadge family={data.family} /> : undefined}
        actions={data && data.family ? <ScanFaresLink intel={data} cabin={cabin} /> : undefined}
      />
      <RoutePicker origin={search.origin} destination={search.destination} cabin={cabin} onChange={go} />
      {!ready ? (
        <div className="grid g-12 items-start">
          <div className="span-8 min-w-0">
            <RouteSuggestions onPick={pick} />
          </div>
          <div className="span-4 min-w-0">
            <AboutPanel />
          </div>
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
