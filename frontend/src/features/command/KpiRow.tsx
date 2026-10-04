import { useQuery } from "@tanstack/react-query";
import { summaryQueryOptions, type DashboardRange, type Kpi, type KpiKey } from "../../api/dashboard";
import { KpiStrip, KpiTile } from "../../ui/charts";
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

/**
 * The strip has 2 columns on phones, 3 on tablets, 4 on laptops and 7 from 1600px. Seven tiles leave a
 * short last row everywhere but the widest screens, so the last tile stretches over the free cells.
 */
// Non-overlapping ranges, so no breakpoint has to win over another in the stylesheet's order.
const LAST_TILE = "max-sm:col-span-2 sm:max-lg:col-span-3 lg:max-[1600px]:col-span-2";

/**
 * Seven across from 1600px. The strip's own `min-[1600px]:grid-cols-7` is emitted before `lg:grid-cols-4`
 * and never applies, so this targets its grid with a child selector, which outranks both.
 */
const SEVEN_ACROSS = "min-[1600px]:[&>div]:grid-cols-7";

/** Grid cell for the tile at `index`: the last one fills its row. */
function cellClass(index: number): string {
  return index === KPI_LABELS.length - 1 ? `grid min-w-0 ${LAST_TILE}` : "grid min-w-0";
}

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
      <KpiStrip label="Key figures" columns={7} className={SEVEN_ACROSS} busy>
        {KPI_LABELS.map(({ key, label }, index) => (
          <div key={key} aria-hidden="true" className={cellClass(index)}>
            <KpiTile label={label} value="" loading />
          </div>
        ))}
      </KpiStrip>
    );
  }

  const byKey = new Map(summary.data.kpis.map((kpi) => [kpi.key, kpi]));
  const currency = summary.data.currency;

  return (
    <KpiStrip label="Key figures" columns={7} className={SEVEN_ACROSS} busy={summary.isPlaceholderData}>
      {KPI_LABELS.map(({ key }, index) => {
        const kpi = byKey.get(key);
        if (!kpi) return null;
        const { value, unit } = formatKpiValue(kpi, currency);
        // Gaps are skipped; a period of zeros has no trend worth drawing.
        const series = kpiSeries(kpi).filter((v): v is number => v !== null);
        return (
          <div key={key} className={cellClass(index)}>
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
    </KpiStrip>
  );
}
