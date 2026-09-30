import { useQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { summaryQueryOptions, type DashboardRange, type Kpi, type KpiKey } from "../../api/dashboard";
import { KpiTile } from "../../ui/charts";
import { cn } from "../../ui/cn";
import { Skeleton } from "../../ui/Skeleton";
import { formatKpiValue, kpiDelta, kpiSeries } from "./format";
import { PanelError } from "./PanelError";

/** The seven headline figures, in the API's order (labels double as loading placeholders). */
const KPI_LABELS: ReadonlyArray<{ key: KpiKey; label: string }> = [
  { key: "open_enquiries", label: "Open enquiries" },
  { key: "quotes_sent", label: "Quotes sent" },
  { key: "win_rate", label: "Win rate" },
  { key: "pipeline_value", label: "Pipeline value" },
  { key: "response_time", label: "Response time" },
  { key: "co2_quoted", label: "CO₂ quoted" },
  { key: "searches", label: "Searches" },
];

const RANGE_DAYS: Record<DashboardRange, number> = { "7d": 7, "30d": 30, "90d": 90 };

/** What each tile's sparkline plots (the daily series, not the headline figure). */
const TREND_LABELS: Record<KpiKey, string> = {
  open_enquiries: "New enquiries per day",
  quotes_sent: "Quotes sent per day",
  win_rate: "Wins per day",
  pipeline_value: "Value sent per day",
  response_time: "Median response time per day",
  co2_quoted: "CO₂ quoted per day",
  searches: "Searches per day",
};

// Two columns on phones, three on tablets, four on laptops, all seven in one row on wide screens.
// The first tile spans two columns until then, so no row is left with a gap.
const GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 min-[1600px]:grid-cols-7";
const TILE = (index: number) => cn("grid min-w-0 tm-enter", index === 0 && "col-span-2 min-[1600px]:col-span-1");

/** Why a tile has no figure: no closed enquiries, no CO₂ on any quoted option, else no quotes sent. */
const EMPTY_HINTS: Partial<Record<KpiKey, string>> = {
  win_rate: "No enquiries closed yet",
  co2_quoted: "No CO₂ figures quoted yet",
};

/** Why a tile has no value or no comparison yet, in words. */
function hintFor(kpi: Kpi, range: DashboardRange): string {
  if (kpi.value === null) return EMPTY_HINTS[kpi.key] ?? "No quotes sent yet";
  if (kpi.key === "pipeline_value") return "Quotes out with clients";
  const days = RANGE_DAYS[range] as number | undefined;
  return days ? `vs previous ${days} days` : "vs previous period";
}

export function KpiRow({ range }: { range: DashboardRange }) {
  const summary = useQuery(summaryQueryOptions(range));

  if (summary.isError && !summary.data) {
    return (
      <section aria-label="Key figures">
        <PanelError error={summary.error} onRetry={() => void summary.refetch()} retrying={summary.isFetching} />
      </section>
    );
  }

  if (!summary.data) {
    // Placeholder tiles stay out of the accessibility tree: a labelled tile only appears with its figure.
    return (
      <section aria-label="Key figures" aria-busy="true" className={GRID}>
        <span className="sr-only">Loading key figures…</span>
        {KPI_LABELS.map(({ key, label }, index) => (
          <div key={key} aria-hidden="true" className={TILE(index)} style={{ "--tm-enter-index": index } as CSSProperties}>
            <div className="tm-glass tm-edge relative flex min-w-0 flex-col gap-2 rounded-md p-4">
              <p className="truncate font-mono text-[11px] uppercase tracking-[0.22em] text-dim">{label}</p>
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-full" />
            </div>
          </div>
        ))}
      </section>
    );
  }

  const byKey = new Map(summary.data.kpis.map((kpi) => [kpi.key, kpi]));
  const currency = summary.data.currency;

  return (
    <section aria-label="Key figures" aria-busy={summary.isPlaceholderData || undefined} className={GRID}>
      {KPI_LABELS.map(({ key }, index) => {
        const kpi = byKey.get(key);
        if (!kpi) return null;
        const style = { "--tm-enter-index": index } as CSSProperties;
        const { value, unit } = formatKpiValue(kpi, currency);
        // Gaps are skipped; a period of zeros has no trend worth drawing.
        const series = kpiSeries(kpi).filter((v): v is number => v !== null);
        return (
          <div key={key} className={TILE(index)} style={style}>
            <KpiTile
              label={kpi.label}
              value={value}
              unit={unit}
              delta={kpiDelta(kpi)}
              series={series.some((v) => v !== 0) ? series : undefined}
              trendLabel={TREND_LABELS[key]}
              hint={hintFor(kpi, summary.data.range)}
            />
          </div>
        );
      })}
    </section>
  );
}
