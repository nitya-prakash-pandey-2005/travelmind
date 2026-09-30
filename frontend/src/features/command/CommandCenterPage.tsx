import { useNavigate, useSearch } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { DASHBOARD_RANGES, DEFAULT_RANGE, isDashboardRange, type DashboardRange } from "../../api/dashboard";
import { useCurrentUser } from "../../auth/useCurrentUser";
import { useClock, zoneAbbreviation } from "../../shell/useClock";
import { Button } from "../../ui/Button";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { cn } from "../../ui/cn";
import { RecentRoutesPanel } from "../dashboard/RecentRoutesPanel";
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

/**
 * One cell of the dashboard grid: 1 column on phones, 2 from 768 px, 12 from 1280 px. Panels rise in
 * with a short stagger on first paint (off under reduced motion) and stretch to their row's height.
 */
function Cell({ span, index, children }: { span: string; index: number; children: ReactNode }) {
  return (
    <div className={cn("tm-enter grid min-w-0", span)} style={{ "--tm-enter-index": index } as CSSProperties}>
      {children}
    </div>
  );
}

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
    <div className="mx-auto flex w-full max-w-[112rem] flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary">Command Center</p>
          <h1 className="font-display text-2xl tracking-wide text-ink sm:text-3xl">
            {greetingFor(now, agency.timezone)}, {firstName}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-xs text-dim">
            <span>{date}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              {time} {zoneAbbreviation(now, agency.timezone, agency.country_code)}
            </span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{agency.name}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl label="Range" options={RANGE_OPTIONS} value={range} onChange={setRange} />
          <Button onClick={openEnquiry}>
            <Plus size={16} aria-hidden="true" />
            New enquiry
          </Button>
        </div>
      </div>

      <OnboardingChecklist key={agency.id} agencyId={agency.id} onNewEnquiry={openEnquiry} />

      <KpiRow range={range} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12">
        <Cell index={0} span="xl:col-span-4">
          <PipelinePanel onNewEnquiry={openEnquiry} className="h-full" />
        </Cell>
        <Cell index={1} span="xl:col-span-5">
          <TrendPanel range={range} className="h-full" />
        </Cell>
        <Cell index={2} span="md:col-span-2 xl:col-span-3">
          <TeamPanel range={range} className="h-full" />
        </Cell>

        <Cell index={3} span="md:col-span-2 xl:col-span-7">
          <RouteMapPanel onNewEnquiry={openEnquiry} className="h-full" />
        </Cell>
        <Cell index={4} span="md:col-span-2 xl:col-span-5">
          <ActivityFeedPanel className="h-full" />
        </Cell>

        <Cell index={5} span="md:col-span-2 xl:col-span-4">
          <MarketPulsePanel className="h-full" />
        </Cell>
        <Cell index={6} span="xl:col-span-4">
          <SupplierHealthPanel className="h-full" />
        </Cell>
        <Cell index={7} span="xl:col-span-4">
          <RouteScanner
            variant="glass"
            className="h-full"
            onRouteReady={record}
            onScanFares={() => void navigate({ to: "/app/fares" })}
          />
        </Cell>

        <Cell index={8} span="md:col-span-2 xl:col-span-8">
          <DeparturesPanel onNewEnquiry={openEnquiry} className="h-full" />
        </Cell>
        <Cell index={9} span="md:col-span-2 xl:col-span-4">
          <RecentRoutesPanel
            variant="glass"
            className="h-full"
            routes={routes}
            onSelect={(route) => routeStore.set({ origin: route.origin, destination: route.destination })}
          />
        </Cell>
      </div>

      <NewEnquiryDialog open={enquiryOpen} onClose={() => setEnquiryOpen(false)} />
    </div>
  );
}
