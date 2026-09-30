import { ChevronDown } from "lucide-react";
import { Fragment } from "react";
import { formatNumber } from "../../lib/format";
import { ChartDataTable, ChartEmpty, GRID, chartColor, formatValue, isValue, useChartAnimation } from "./shared";

export type FunnelStage = { label: string; count: number; value?: number };

const BAR = 14;
const GRID_COLS = "grid grid-cols-[minmax(0,1.3fr)_minmax(0,3fr)_minmax(4.5rem,auto)] items-center gap-3";

/** Step-to-step conversion: round(next / prev × 100) %, or "—" when the previous stage is empty. */
function conversion(prev: FunnelStage | undefined, next: FunnelStage): string {
  return prev && isValue(prev.count) && prev.count > 0 && isValue(next.count)
    ? `${Math.round((next.count / prev.count) * 100)}%`
    : "—";
}

/** Pipeline stages as centred bars narrowing by count, with the conversion between each pair of steps. */
export function Funnel({
  stages,
  label,
  valueFormat,
}: {
  stages: FunnelStage[];
  label: string;
  valueFormat: (value: number) => string;
}) {
  const animate = useChartAnimation();
  if (stages.length === 0) return <ChartEmpty label={label} height={120} />;

  const top = Math.max(0, ...stages.map((s) => s.count).filter(isValue));
  const hasValue = stages.some((s) => s.value !== undefined);
  const steps = stages.map((stage, i) => ({ stage, prev: i > 0 ? stages[i - 1] : undefined }));
  const summary = steps
    .map(({ stage, prev }) => {
      const base = `${stage.label} ${formatValue(stage.count, formatNumber)}`;
      return prev && prev.count > 0 ? `${base} (${conversion(prev, stage)} of ${prev.label})` : base;
    })
    .join(", ");

  return (
    <div className="min-w-0">
      <div role="img" aria-label={`${label}: ${summary}`} className="flex flex-col">
        {steps.map(({ stage, prev }, i) => {
          // Non-empty stages keep a sliver so they never vanish next to a large first step.
          const count = isValue(stage.count) ? stage.count : 0;
          const pct = top > 0 ? Math.max((count / top) * 100, count > 0 ? 1.5 : 0) : 0;
          const width = Math.round(pct * 100) / 100;
          return (
            <Fragment key={`${stage.label}-${i}`}>
              {prev && (
                <div className={GRID_COLS}>
                  <span />
                  <span className="flex items-center justify-center gap-1 py-0.5 font-mono text-[11px] tabular-nums text-dim">
                    <ChevronDown size={12} aria-hidden="true" />
                    <span data-conversion="">{conversion(prev, stage)}</span>
                  </span>
                  <span />
                </div>
              )}
              <div className={GRID_COLS}>
                <span className="truncate text-sm text-ink">{stage.label}</span>
                <svg aria-hidden="true" width="100%" height={BAR} className="block overflow-visible">
                  <rect width="100%" height={BAR} rx={4} fill={GRID} />
                  {width > 0 && (
                    <rect
                      data-stage-bar=""
                      x={`${(100 - width) / 2}%`}
                      width={`${width}%`}
                      height={BAR}
                      rx={4}
                      fill={chartColor(1)}
                      fillOpacity={0.85}
                      data-animate={animate ? "" : undefined}
                      className={animate ? "tm-grow-x" : undefined}
                      style={animate ? { transformOrigin: "center", animationDelay: `${i * 70}ms` } : undefined}
                    />
                  )}
                </svg>
                <span className="flex flex-col items-end">
                  <span data-count="" className="font-mono text-sm tabular-nums text-ink">
                    {formatValue(stage.count, formatNumber)}
                  </span>
                  {stage.value !== undefined && (
                    <span data-value="" className="font-mono text-[11px] tabular-nums text-dim">
                      {formatValue(stage.value, valueFormat)}
                    </span>
                  )}
                </span>
              </div>
            </Fragment>
          );
        })}
      </div>
      <ChartDataTable
        caption={`${label} data`}
        headers={["Stage", "Count", ...(hasValue ? ["Value"] : []), "Conversion"]}
        rows={steps.map(({ stage, prev }) => [
          stage.label,
          formatValue(stage.count, formatNumber),
          ...(hasValue ? [formatValue(stage.value, valueFormat)] : []),
          prev && prev.count > 0 ? `${conversion(prev, stage)} from ${prev.label}` : "—",
        ])}
      />
    </div>
  );
}
