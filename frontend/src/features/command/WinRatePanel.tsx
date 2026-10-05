import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { summaryQueryOptions, type DashboardRange } from "../../api/dashboard";
import { Gauge, Stat } from "../../kit";
import { EmptyState } from "../../ui/EmptyState";
import { Panel } from "../../ui/Panel";
import { cn } from "../../ui/cn";
import { formatKpiValue, kpiDelta } from "./format";
import { ErrorPanel } from "./PanelError";
import { LoadingPanel } from "./panelParts";

const TITLE = "Win rate";
/** Icon chip in the card head. */
const ICON = Trophy;
const RANGE_WORDS: Record<DashboardRange, string> = { "7d": "last 7 days", "30d": "last 30 days", "90d": "last 90 days" };
const THIS_WORDS: Record<DashboardRange, string> = { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days" };
const PREVIOUS_WORDS: Record<DashboardRange, string> = { "7d": "Previous 7 days", "30d": "Previous 30 days", "90d": "Previous 90 days" };
const POINTS = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, signDisplay: "exceptZero" });

/**
 * The dashboard's hero gauge: the win rate (share of closed enquiries won) for the selected range on the kit's
 * HUD ring, with this period, the previous one and the change in percentage points under it.
 */
export function WinRatePanel({ range, className }: { range: DashboardRange; className?: string }) {
  const summary = useQuery(summaryQueryOptions(range));
  const shown = summary.data?.range ?? range;
  const description = `Share of closed enquiries won, ${RANGE_WORDS[shown] ?? RANGE_WORDS[range]}`;

  if (summary.isPending) return <LoadingPanel title={TITLE} icon={ICON} description={description} rows={6} className={className} />;
  if (summary.isError && !summary.data) {
    return (
      <ErrorPanel
        title={TITLE}
        icon={ICON}
        description={description}
        error={summary.error}
        onRetry={() => void summary.refetch()}
        retrying={summary.isFetching}
        className={className}
      />
    );
  }

  const kpi = summary.data.kpis.find((item) => item.key === "win_rate");
  const value = kpi?.value;
  const delta = kpi ? kpiDelta(kpi) : undefined;
  const previous = kpi && kpi.previous !== null ? formatKpiValue({ ...kpi, value: kpi.previous }, summary.data.currency).value : "—";

  return (
    <Panel
      title={TITLE}
      icon={ICON}
      description={description}
      busy={summary.isPlaceholderData}
      className={cn("flex flex-col", className)}
    >
      {kpi === undefined || value === null || value === undefined || !Number.isFinite(value) ? (
        <EmptyState
          icon={Trophy}
          title="No enquiries closed yet"
          description="The win rate appears once enquiries are marked won or lost."
          action={{ label: "Open pipeline", to: "/app/pipeline" }}
        />
      ) : (
        <div className="flex flex-1 flex-col justify-between gap-4">
          <Gauge score={value} label="Win rate" sub="% won" color="var(--tm-ok)" size={216} />
          <div className="grid grid-cols-3 gap-2 border-t border-line pt-3.5 [&_.v]:text-[22px]">
            <Stat value={formatKpiValue(kpi, summary.data.currency).value} label={THIS_WORDS[shown] ?? "This period"} />
            <Stat value={previous} label={PREVIOUS_WORDS[shown] ?? "Previous period"} />
            <Stat
              value={delta && delta.pct !== null ? POINTS.format(delta.pct) : "—"}
              unit={delta && delta.pct !== null ? " pts" : undefined}
              tone={!delta || delta.pct === null || delta.direction === "flat" ? undefined : delta.good ? "green" : "rose"}
              label="Change"
            />
          </div>
        </div>
      )}
    </Panel>
  );
}
