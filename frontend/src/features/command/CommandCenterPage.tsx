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
import { WinRatePanel } from "./WinRatePanel";

const RANGE_OPTIONS = DASHBOARD_RANGES.map((value) => ({ value, label: value }));

function safeFormat(date: Date, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-GB", options).format(date);
  }
}

/** One card slot of the kit's 12-column grid (full width under 1180 px). Its card stretches to the row's height. */
function Cell({ span, children }: { span: string; children: ReactNode }) {
  return <div className={cn("grid min-w-0", span)}>{children}</div>;
}

// Above the kit grid's 1180 px collapse. Size containment lets the neighbouring cards set the row height.
/** Takes its row's height from the card beside it. */
const WIDE_MATCH = "min-[1181px]:[contain:size] min-[1181px]:min-h-[20rem]";
/** Two rows tall. */
const WIDE_TALL = "min-[1181px]:row-span-2 min-[1181px]:[contain:size] min-[1181px]:min-h-[30rem]";

/**
 * The Command Center as a kit dashboard: page head (range and New enquiry on the right), the setup checklist
 * (until done or dismissed), the KPI row, a hero row with the win-rate gauge beside the activity trend, then the
 * detail cards on the 12-column grid:
 *   win rate 5 · trend 7 / route map 8 · (pipeline + route planner) 4 / market pulse 7 + supplier health 7 ·
 *   live activity 5 (two rows tall) / team 6 · departures 6.
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
    <div className="flex w-full min-w-0 flex-col">
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

        <div className="grid g-12">
          <Cell span="span-5">
            <WinRatePanel range={range} />
          </Cell>
          <Cell span="span-7">
            <TrendPanel range={range} className="flex flex-col" />
          </Cell>

          <Cell span="span-8">
            <RouteMapPanel onNewEnquiry={openEnquiry} />
          </Cell>
          <div className="span-4 flex min-w-0 flex-col gap-4">
            <PipelinePanel onNewEnquiry={openEnquiry} />
            <RouteScanner className="flex-1" onRouteReady={record} onScanFares={() => void navigate({ to: "/app/fares" })}>
              <RecentRoutes
                routes={routes}
                onSelect={(route) => routeStore.set({ origin: route.origin, destination: route.destination })}
              />
            </RouteScanner>
          </div>

          <Cell span="span-7">
            <MarketPulsePanel />
          </Cell>
          {/* Two rows tall beside market pulse and supplier health. Size containment lets those two set the
              height, and the feed scrolls inside it rather than stretching the rows. */}
          <Cell span={cn("span-5", WIDE_TALL)}>
            <ActivityFeedPanel className="h-full min-h-0" />
          </Cell>
          <Cell span="span-7">
            <SupplierHealthPanel />
          </Cell>

          <Cell span="span-6">
            <TeamPanel range={range} />
          </Cell>
          {/* As tall as the team card beside it; the departures table scrolls inside. */}
          <Cell span={cn("span-6", WIDE_MATCH)}>
            <DeparturesPanel onNewEnquiry={openEnquiry} className="h-full min-h-0" />
          </Cell>
        </div>
      </div>

      <NewEnquiryDialog open={enquiryOpen} onClose={() => setEnquiryOpen(false)} />
    </div>
  );
}
