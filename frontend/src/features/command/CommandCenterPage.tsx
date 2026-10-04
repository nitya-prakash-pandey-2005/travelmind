import { useNavigate, useSearch } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { DASHBOARD_RANGES, DEFAULT_RANGE, isDashboardRange, type DashboardRange } from "../../api/dashboard";
import { useCurrentUser } from "../../auth/useCurrentUser";
import { useClock, zoneAbbreviation } from "../../shell/useClock";
import { Button } from "../../ui/Button";
import { PageHeader } from "../../ui/PageHeader";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { cn } from "../../ui/cn";
import { RecentRoutes } from "../dashboard/RecentRoutes";
import { RouteScanner } from "../route/RouteScanner";
import { useRecentRoutes } from "../route/recentRoutes";
import { routeStore } from "../route/routeStore";
import { ActivityFeedPanel } from "./ActivityFeedPanel";
import { DeparturesPanel } from "./DeparturesPanel";
import { greetingFor } from "./format";
import { KpiRow } from "./KpiRow";
import { MarketPulsePanel } from "./MarketPulsePanel";
import { NewEnquiryDialog } from "./NewEnquiryDialog";
import { OnboardingChecklist } from "./OnboardingChecklist";
import { PipelinePanel } from "./PipelinePanel";
import { RouteMapPanel } from "./RouteMapPanel";
import { SupplierHealthPanel } from "./SupplierHealthPanel";
import { TeamPanel } from "./TeamPanel";
import { TrendPanel } from "./TrendPanel";

const RANGE_OPTIONS = DASHBOARD_RANGES.map((value) => ({ value, label: value }));

function safeFormat(date: Date, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-GB", options).format(date);
  }
}

/** One card slot of the 12-column grid (one column below 1280 px). Cards stretch to their row's height. */
function Cell({ span, children }: { span: string; children: ReactNode }) {
  return <div className={cn("grid min-w-0", span)}>{children}</div>;
}

/**
 * The Command Center: page header, setup checklist (until done or dismissed), the key-figure strip, then
 * cards on a 12-column grid, from the day's numbers down to the detail:
 *   trend 8 · pipeline 4 / route map 8 · route planner 4 / market pulse 7 + supplier health 7 · live activity 5
 *   (two rows tall) / departures 7 · team 5.
 */
export function CommandCenterPage() {
  const me = useCurrentUser();
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  const range: DashboardRange = isDashboardRange(search.range) ? search.range : DEFAULT_RANGE;
  const [enquiryOpen, setEnquiryOpen] = useState(false);
  const now = useClock(30_000);
  const { routes, record } = useRecentRoutes(me?.user.id ?? "anonymous");

  if (!me) return null;
  const { agency } = me;
  const firstName = me.user.full_name.trim().split(/\s+/)[0] || me.user.full_name;
  const openEnquiry = () => setEnquiryOpen(true);
  const setRange = (next: DashboardRange) =>
    void navigate({ to: "/app", search: { range: next === DEFAULT_RANGE ? undefined : next }, replace: true });

  const date = safeFormat(now, agency.timezone, { weekday: "long", day: "numeric", month: "long" });
  const time = safeFormat(now, agency.timezone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

  return (
    <div className="mx-auto flex w-full max-w-[112rem] flex-col">
      <PageHeader
        dotGrid
        breadcrumb={[{ label: "Workspace" }, { label: "Command Center" }]}
        title="Command Center"
        description={
          <>
            {greetingFor(now, agency.timezone)}, {firstName}
            {" · "}
            <time dateTime={now.toISOString()} className="font-mono text-xs tabular-nums">
              {date}, {time} {zoneAbbreviation(now, agency.timezone, agency.country_code)}
            </time>
            {" · "}
            {agency.name}
          </>
        }
        actions={
          <>
            <SegmentedControl label="Range" options={RANGE_OPTIONS} value={range} onChange={setRange} />
            <Button onClick={openEnquiry}>
              <Plus size={16} aria-hidden="true" />
              New enquiry
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-4">
        <OnboardingChecklist key={agency.id} agencyId={agency.id} onNewEnquiry={openEnquiry} />

        <KpiRow range={range} />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <Cell span="xl:col-span-8">
            <TrendPanel range={range} />
          </Cell>
          <Cell span="xl:col-span-4">
            <PipelinePanel onNewEnquiry={openEnquiry} />
          </Cell>

          <Cell span="xl:col-span-8">
            <RouteMapPanel onNewEnquiry={openEnquiry} />
          </Cell>
          <Cell span="xl:col-span-4">
            <RouteScanner onRouteReady={record} onScanFares={() => void navigate({ to: "/app/fares" })}>
              <RecentRoutes
                routes={routes}
                onSelect={(route) => routeStore.set({ origin: route.origin, destination: route.destination })}
              />
            </RouteScanner>
          </Cell>

          <Cell span="xl:col-span-7">
            <MarketPulsePanel />
          </Cell>
          {/* Two rows tall beside market pulse and supplier health. Size containment lets those two set the
              height, and the feed scrolls inside it rather than stretching the rows. */}
          <Cell span="xl:col-span-5 xl:row-span-2 xl:[contain:size] xl:min-h-[30rem]">
            <ActivityFeedPanel className="h-full" />
          </Cell>
          <Cell span="xl:col-span-7">
            <SupplierHealthPanel />
          </Cell>

          <Cell span="xl:col-span-7">
            <DeparturesPanel onNewEnquiry={openEnquiry} />
          </Cell>
          <Cell span="xl:col-span-5">
            <TeamPanel range={range} />
          </Cell>
        </div>
      </div>

      <NewEnquiryDialog open={enquiryOpen} onClose={() => setEnquiryOpen(false)} />
    </div>
  );
}
