import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatDayMonth } from "../../lib/format";
import { useElementSize } from "../../lib/useElementSize";
import { ChartTooltip } from "./ChartTooltip";
import { areaPath, linearScale, niceMax, niceTicks, pathFromPoints, pickTickIndices, type Point } from "./scale";
import {
  ChartDataTable,
  ChartEmpty,
  FALLBACK_WIDTH,
  formatValue,
  isValue,
  useChartAnimation,
  useChartColors,
  type ChartColor,
} from "./shared";

export type TrendSeries = {
  key: string;
  label: string;
  color: ChartColor;
  /**
   * A non-negative series (counts, amounts): negative values are drawn on the baseline.
   * A null or non-finite value is a gap: skipped by the line, shown as "—" in the tooltip and table.
   */
  points: { date: string; value: number | null }[];
  /** Shade the area under the line (default true). Off for a line drawn over a band. */
  area?: boolean;
};

/**
 * A shaded range between two values per date (e.g. the 25th to 75th percentile). A date where either end is
 * missing is a gap: the shading stops there and resumes at the next complete date.
 */
export type TrendBand = {
  label: string;
  color: ChartColor;
  points: { date: string; low: number | null; high: number | null }[];
};

type AreaTrendProps = {
  series: TrendSeries[];
  height?: number;
  valueFormat: (value: number) => string;
  /** Names the chart for assistive tech and captions its data table. */
  label: string;
  /** Optional shaded range drawn under the series, listed after them in the legend, tooltip and table. */
  band?: TrendBand;
};

const PAD_TOP = 10;
const PAD_RIGHT = 12;
const PAD_BOTTOM = 24;
const AXIS_FONT = 10;
// Approximate advance of one mono glyph at AXIS_FONT, for sizing the y-axis gutter.
const GLYPH = 6.2;

/**
 * Multi-series area chart over dates on one shared y-axis. Keyboard: focus the chart, then
 * Left/Right (Home/End) move a crosshair; the tooltip lists every series at that date.
 */
export function AreaTrend({ series, height = 180, valueFormat, label, band }: AreaTrendProps) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const animate = useChartAnimation();
  const colors = useChartColors();
  const [active, setActive] = useState<number | null>(null);
  const focused = useRef(false);
  const tooltipId = useId();

  const dates = useMemo(
    () => [...new Set([...series.flatMap((s) => s.points.map((p) => p.date)), ...(band?.points.map((p) => p.date) ?? [])])].sort(),
    [series, band],
  );
  const lookups = useMemo(() => series.map((s) => new Map(s.points.map((p) => [p.date, p.value]))), [series]);
  const bandLookup = useMemo(() => new Map(band?.points.map((p) => [p.date, p] as const) ?? []), [band]);

  if (dates.length === 0) return <ChartEmpty label={label} height={height} />;

  const width = size.width || FALLBACK_WIDTH;
  const n = dates.length;
  const values = [
    ...series.flatMap((s) => s.points.map((p) => p.value)),
    ...(band?.points.flatMap((p) => [p.low, p.high]) ?? []),
  ].filter(isValue);
  const max = Math.max(0, ...values);
  const top = niceMax(max);
  const integerData = values.every(Number.isInteger);
  const ticks = niceTicks(max).filter((t) => !integerData || Number.isInteger(t));
  const tickLabels = ticks.map(valueFormat);
  const longest = Math.max(...tickLabels.map((t) => t.length));
  const padLeft = Math.min(Math.max(longest * GLYPH + 14, 24), width * 0.35);
  const right = width - PAD_RIGHT;
  const baseline = height - PAD_BOTTOM;
  const x = linearScale([0, n - 1], [padLeft, right]);
  const y = linearScale([0, top], [baseline, PAD_TOP]);
  const maxTicks = Math.max(2, Math.min(6, Math.floor((right - padLeft) / 64)));
  const xTicks = pickTickIndices(n, maxTicks);

  const dayLabels = dates.map(formatDayMonth);
  const dayAt = (dateIndex: number) => dayLabels[dateIndex] ?? "";
  const valueAt = (seriesIndex: number, dateIndex: number) => lookups[seriesIndex]?.get(dates[dateIndex] ?? "");
  const pointsOf = (seriesIndex: number) => plotted[seriesIndex] ?? [];
  const plotted = series.map((_, si) =>
    dates.flatMap((_, di): Point[] => {
      const v = valueAt(si, di);
      return isValue(v) ? [[x(di), y(Math.max(0, v))]] : [];
    }),
  );

  const rangeAt = (dateIndex: number): [number, number] | null => {
    const point = bandLookup.get(dates[dateIndex] ?? "");
    return point && isValue(point.low) && isValue(point.high) ? [point.low, point.high] : null;
  };
  // One closed shape per run of consecutive dates with both ends: along the highs, back along the lows.
  const bandPieces: string[] = [];
  if (band) {
    const bandPath = (indices: number[]) => {
      const edge = (pick: 0 | 1) =>
        indices.map((di): Point => [x(di), y(Math.max(0, (rangeAt(di) as [number, number])[pick]))]);
      let highs = edge(1);
      let lows = edge(0).reverse();
      if (indices.length === 1) {
        // A lone date: a narrow bar, so the range still shows.
        const [[hx, hy]] = highs as [Point];
        const [[, ly]] = lows as [Point];
        highs = [[hx - 2, hy], [hx + 2, hy]];
        lows = [[hx + 2, ly], [hx - 2, ly]];
      }
      return `${pathFromPoints([...highs, ...lows])}Z`;
    };
    let run: number[] = [];
    const flush = () => {
      if (run.length > 0) bandPieces.push(bandPath(run));
      run = [];
    };
    dates.forEach((_, di) => {
      if (rangeAt(di)) run.push(di);
      else flush();
    });
    flush();
  }
  const rangeText = (dateIndex: number) => {
    const range = rangeAt(dateIndex);
    return range ? `${valueFormat(range[0])}–${valueFormat(range[1])}` : "—";
  };

  const indexAt = (px: number) => {
    if (n === 1) return 0;
    const raw = Math.round(((px - padLeft) / (right - padLeft)) * (n - 1));
    return Math.min(n - 1, Math.max(0, raw));
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    setActive(indexAt(((event.clientX - rect.left) / rect.width) * width));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, (i: number) => number> = {
      ArrowRight: (i) => Math.min(n - 1, i + 1),
      ArrowLeft: (i) => Math.max(0, i - 1),
      Home: () => 0,
      End: () => n - 1,
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    setActive((i) => move(i ?? 0));
  };

  const formatted = (v: number | null | undefined) => formatValue(v, valueFormat);
  const tooltipRows =
    active === null
      ? []
      : [
          ...series.map((s, si) => ({ key: s.key, label: s.label, value: formatted(valueAt(si, active)), color: colors.series(s.color) })),
          ...(band ? [{ key: "__band", label: band.label, value: rangeText(active), color: colors.series(band.color) }] : []),
        ];
  const readout =
    active === null ? "" : `${dayAt(active)}: ${tooltipRows.map((r) => `${r.label} ${r.value}`).join(", ")}`;

  const summary = `${label}: ${n} ${n === 1 ? "point" : "points"}, ${dayAt(0)} to ${dayAt(n - 1)}. ${series
    .map((s, si) => {
      const own = s.points.map((p) => p.value).filter(isValue);
      return own.length === 0 ? `${s.label} no data` : `${s.label} latest ${formatted(valueAt(si, n - 1))}, peak ${valueFormat(Math.max(...own))}`;
    })
    .join("; ")}${band ? `; ${band.label} latest ${rangeText(n - 1)}` : ""}. Use arrow keys to read each date.`;
  const legend = [
    ...series.map((s) => ({ key: s.key, label: s.label, color: s.color, isBand: false })),
    ...(band ? [{ key: "band", label: band.label, color: band.color, isBand: true }] : []),
  ];

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {legend.length > 1 && (
        <ul aria-label={`${label} legend`} className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-dim">
          {legend.map((s) => (
            <li key={`${s.isBand ? "band" : "series"}-${s.key}`} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-[2px]"
                style={{ background: colors.series(s.color), opacity: s.isBand ? 0.45 : undefined }}
              />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div ref={ref} className="relative min-w-0">
        <div
          role="img"
          tabIndex={0}
          aria-label={summary}
          aria-describedby={active === null ? undefined : tooltipId}
          onFocus={() => {
            focused.current = true;
            setActive((i) => i ?? 0);
          }}
          onBlur={() => {
            focused.current = false;
            setActive(null);
          }}
          onKeyDown={onKeyDown}
          className="rounded-sm"
        >
          <svg
            aria-hidden="true"
            width="100%"
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className="block touch-pan-y select-none"
            onPointerMove={onPointerMove}
            onPointerLeave={() => {
              if (!focused.current) setActive(null);
            }}
          >
            {ticks.map((tick, i) => {
              const ty = Math.round(y(tick)) + 0.5;
              return (
                <g key={tick}>
                  <line
                    data-gridline=""
                    x1={padLeft}
                    x2={right}
                    y1={ty}
                    y2={ty}
                    stroke={tick === 0 ? colors.axis : colors.grid}
                    strokeOpacity={tick === 0 ? 0.35 : 1}
                    strokeWidth={1}
                    shapeRendering="crispEdges"
                  />
                  <text
                    x={padLeft - 8}
                    y={ty}
                    textAnchor="end"
                    dominantBaseline="middle"
                    fill={colors.axis}
                    fontSize={AXIS_FONT}
                    className="font-mono tabular-nums"
                  >
                    {tickLabels[i]}
                  </text>
                </g>
              );
            })}
            {xTicks.map((di) => (
              <text
                key={di}
                data-x-tick=""
                x={x(di)}
                y={height - 6}
                textAnchor={n === 1 ? "middle" : di === 0 ? "start" : di === n - 1 ? "end" : "middle"}
                fill={colors.axis}
                fontSize={AXIS_FONT}
                className="font-mono tabular-nums"
              >
                {dayAt(di)}
              </text>
            ))}
            {band &&
              bandPieces.map((d, i) => (
                <path
                  key={`band-${i}`}
                  data-band=""
                  d={d}
                  fill={colors.series(band.color)}
                  fillOpacity={0.18}
                  data-animate={animate ? "" : undefined}
                  className={animate ? "tm-fade-in" : undefined}
                  style={animate ? { animationDelay: "160ms" } : undefined}
                />
              ))}
            {series.map((s, si) =>
              s.area === false ? null : (
                <path
                  key={`area-${s.key}`}
                  data-area=""
                  d={areaPath(pointsOf(si), baseline)}
                  fill={colors.series(s.color)}
                  fillOpacity={0.15}
                  data-animate={animate ? "" : undefined}
                  className={animate ? "tm-fade-in" : undefined}
                  style={animate ? { animationDelay: `${200 + si * 80}ms` } : undefined}
                />
              ),
            )}
            {series.map((s, si) => (
              <path
                key={`line-${s.key}`}
                data-line=""
                d={pathFromPoints(pointsOf(si))}
                fill="none"
                stroke={colors.series(s.color)}
                strokeWidth={1.75}
                strokeLinejoin="round"
                strokeLinecap="round"
                pathLength={animate ? 1 : undefined}
                data-animate={animate ? "" : undefined}
                className={animate ? "tm-draw" : undefined}
                style={animate ? { animationDelay: `${si * 80}ms` } : undefined}
              />
            ))}
            {n === 1 &&
              series.map((s, si) =>
                pointsOf(si).map(([px, py]) => (
                  <circle key={`dot-${s.key}`} cx={px} cy={py} r={3.5} fill={colors.series(s.color)} stroke={colors.surface} strokeWidth={2} />
                )),
              )}
            {active !== null && (
              <g data-crosshair="">
                <line
                  x1={Math.round(x(active)) + 0.5}
                  x2={Math.round(x(active)) + 0.5}
                  y1={PAD_TOP}
                  y2={baseline}
                  stroke={colors.axis}
                  strokeOpacity={0.55}
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                {series.map((s, si) => {
                  const v = valueAt(si, active);
                  if (!isValue(v)) return null;
                  return <circle key={s.key} cx={x(active)} cy={y(Math.max(0, v))} r={4} fill={colors.series(s.color)} stroke={colors.surface} strokeWidth={2} />;
                })}
              </g>
            )}
          </svg>
        </div>
        {active !== null && (
          <ChartTooltip id={tooltipId} x={x(active)} width={width} top={PAD_TOP} title={dayAt(active)} rows={tooltipRows} />
        )}
      </div>
      <span className="sr-only" aria-live="polite">
        {readout}
      </span>
      <ChartDataTable
        caption={`${label} data`}
        headers={["Date", ...series.map((s) => s.label), ...(band ? [band.label] : [])]}
        rows={dates.map((_, di) => [
          dayAt(di),
          ...series.map((_, si) => formatted(valueAt(si, di))),
          ...(band ? [rangeText(di)] : []),
        ])}
      />
    </div>
  );
}
