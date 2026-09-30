import { useQuery } from "@tanstack/react-query";
import { ChartLine } from "lucide-react";
import { summaryQueryOptions, type DashboardRange, type KpiKey } from "../../api/dashboard";
import { formatNumber } from "../../lib/format";
import { AreaTrend, type ChartColor, type TrendSeries } from "../../ui/charts";
import { EmptyState } from "../../ui/EmptyState";
import { Panel } from "../../ui/Panel";
import { PanelSkeleton } from "../../ui/Skeleton";
import { kpiSeries } from "./format";
import { ErrorPanel } from "./PanelError";

const TITLE = "Activity trend";
const RANGE_LABEL: Record<DashboardRange, string> = { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days" };

/** Daily counts on one axis: all three are counts of things the team did. Colours follow the series, fixed. */
const SERIES: ReadonlyArray<{ key: KpiKey; label: string; color: ChartColor }> = [
  { key: "open_enquiries", label: "Enquiries", color: 1 },
  { key: "quotes_sent", label: "Quotes sent", color: 2 },
  { key: "searches", label: "Searches", color: 3 },
];

export function TrendPanel({ range, className }: { range: DashboardRange; className?: string }) {
  const summary = useQuery(summaryQueryOptions(range));
  const eyebrow = `Daily · ${RANGE_LABEL[summary.data?.range ?? range] ?? RANGE_LABEL[range]}`;

  if (summary.isPending) return <PanelSkeleton title={TITLE} eyebrow={eyebrow} className={className} />;
  if (summary.isError && !summary.data) {
    return (
      <ErrorPanel
        title={TITLE}
        eyebrow={eyebrow}
        error={summary.error}
        onRetry={() => void summary.refetch()}
        retrying={summary.isFetching}
        className={className}
      />
    );
  }

  const byKey = new Map(summary.data.kpis.map((kpi) => [kpi.key, kpi]));
  const series: TrendSeries[] = SERIES.flatMap(({ key, label, color }) => {
    const kpi = byKey.get(key);
    if (!kpi) return [];
    const values = kpiSeries(kpi);
    return [{ key, label, color, points: kpi.series.map((point, i) => ({ date: point.date, value: values[i] ?? null })) }];
  });
  const empty = series.every((s) => s.points.every((p) => !p.value));

  return (
    <Panel variant="glass" title={TITLE} eyebrow={eyebrow} busy={summary.isPlaceholderData} className={className}>
      {empty ? (
        <EmptyState
          icon={ChartLine}
          title="Nothing to chart yet"
          description="Enquiries, quotes and fare searches show up here day by day."
          action={{ label: "Run a fare scan", to: "/app/fares" }}
        />
      ) : (
        <AreaTrend label="Enquiries, quotes sent and searches per day" series={series} valueFormat={formatNumber} height={200} />
      )}
    </Panel>
  );
}
