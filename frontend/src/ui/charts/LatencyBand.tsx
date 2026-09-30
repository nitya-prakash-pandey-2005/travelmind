import { formatNumber } from "../../lib/format";
import { ChartDataTable, GRID, chartColor, isValue, percent, useChartAnimation } from "./shared";

const BAR = 10;

function ms(value: number): string {
  return isValue(value) ? `${formatNumber(Math.round(value))} ms` : "—";
}

/**
 * Response-time spread on a 0…max track: the solid segment reaches p50 (half of requests),
 * the soft band extends to p95, and a marker pins the median.
 */
export function LatencyBand({
  p50,
  p95,
  max,
  label = "Latency",
}: {
  p50: number;
  p95: number;
  max: number;
  /** Names the band for assistive tech; give each band on a page its own label. */
  label?: string;
}) {
  const animate = useChartAnimation();
  const scale = Math.max(0, ...[p50, p95, max].filter(isValue));
  const p50Pct = percent(p50, scale);
  const p95Pct = percent(p95, scale);
  const caption = `p50 ${ms(p50)} · p95 ${ms(p95)}`;
  const color = chartColor(1);

  return (
    <div className="min-w-0">
      <div role="img" aria-label={`${label}: p50 ${ms(p50)}, p95 ${ms(p95)}, max ${ms(max)}`} className="flex flex-col gap-1.5">
        <svg aria-hidden="true" width="100%" height={BAR} className="block overflow-visible">
          <rect width="100%" height={BAR} rx={BAR / 2} fill={GRID} />
          <g data-animate={animate ? "" : undefined} className={animate ? "tm-grow-x" : undefined}>
            <rect width={p95Pct} height={BAR} rx={BAR / 2} fill={color} fillOpacity={0.22} />
            <rect width={p50Pct} height={BAR} rx={BAR / 2} fill={color} fillOpacity={0.6} />
          </g>
          {p50Pct !== "0%" && (
            <line x1={p50Pct} x2={p50Pct} y1={-2} y2={BAR + 2} stroke={color} strokeWidth={2} strokeLinecap="round" />
          )}
        </svg>
        <p className="font-mono text-[11px] tabular-nums text-dim">{caption}</p>
      </div>
      <ChartDataTable
        caption={`${label} data`}
        headers={["Percentile", "Latency"]}
        rows={[
          ["p50", ms(p50)],
          ["p95", ms(p95)],
          ["max", ms(max)],
        ]}
      />
    </div>
  );
}
