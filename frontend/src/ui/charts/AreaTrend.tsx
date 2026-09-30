import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatDayMonth } from "../../lib/format";
import { useElementSize } from "../../lib/useElementSize";
import { ChartTooltip } from "./ChartTooltip";
import { areaPath, linearScale, niceMax, niceTicks, pathFromPoints, pickTickIndices, type Point } from "./scale";
import { AXIS, ChartDataTable, ChartEmpty, FALLBACK_WIDTH, GRID, SURFACE, chartColor, useChartAnimation, type ChartColor } from "./shared";

export type TrendSeries = {
  key: string;
  label: string;
  color: ChartColor;
  points: { date: string; value: number }[];
};

type AreaTrendProps = {
  series: TrendSeries[];
  height?: number;
  valueFormat: (value: number) => string;
  /** Names the chart for assistive tech and captions its data table. */
  label: string;
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
export function AreaTrend({ series, height = 180, valueFormat, label }: AreaTrendProps) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const animate = useChartAnimation();
  const [active, setActive] = useState<number | null>(null);
  const focused = useRef(false);
  const tooltipId = useId();

  const dates = useMemo(() => [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort(), [series]);
  const lookups = useMemo(() => series.map((s) => new Map(s.points.map((p) => [p.date, p.value]))), [series]);

  if (dates.length === 0) return <ChartEmpty label={label} height={height} />;

  const width = size.width || FALLBACK_WIDTH;
  const n = dates.length;
  const values = series.flatMap((s) => s.points.map((p) => p.value)).filter(Number.isFinite);
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
      return v === undefined || !Number.isFinite(v) ? [] : [[x(di), y(v)]];
    }),
  );

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

  const formatted = (v: number | undefined) => (v === undefined ? "—" : valueFormat(v));
  const tooltipRows =
    active === null
      ? []
      : series.map((s, si) => ({ key: s.key, label: s.label, value: formatted(valueAt(si, active)), color: chartColor(s.color) }));
  const readout =
    active === null ? "" : `${dayAt(active)}: ${tooltipRows.map((r) => `${r.label} ${r.value}`).join(", ")}`;

  const summary = `${label}: ${n} ${n === 1 ? "point" : "points"}, ${dayAt(0)} to ${dayAt(n - 1)}. ${series
    .map((s, si) => {
      const own = s.points.map((p) => p.value);
      return own.length === 0 ? `${s.label} no data` : `${s.label} latest ${formatted(valueAt(si, n - 1))}, peak ${valueFormat(Math.max(...own))}`;
    })
    .join("; ")}. Use arrow keys to read each date.`;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {series.length > 1 && (
        <ul aria-label={`${label} legend`} className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-dim">
          {series.map((s) => (
            <li key={s.key} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2 w-2 rounded-[2px]" style={{ background: chartColor(s.color) }} />
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
                    stroke={tick === 0 ? AXIS : GRID}
                    strokeOpacity={tick === 0 ? 0.35 : 1}
                    strokeWidth={1}
                    shapeRendering="crispEdges"
                  />
                  <text
                    x={padLeft - 8}
                    y={ty}
                    textAnchor="end"
                    dominantBaseline="middle"
                    fill={AXIS}
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
                fill={AXIS}
                fontSize={AXIS_FONT}
                className="font-mono tabular-nums"
              >
                {dayAt(di)}
              </text>
            ))}
            {series.map((s, si) => (
              <path
                key={`area-${s.key}`}
                data-area=""
                d={areaPath(pointsOf(si), baseline)}
                fill={chartColor(s.color)}
                fillOpacity={0.15}
                data-animate={animate ? "" : undefined}
                className={animate ? "tm-fade-in" : undefined}
                style={animate ? { animationDelay: `${200 + si * 80}ms` } : undefined}
              />
            ))}
            {series.map((s, si) => (
              <path
                key={`line-${s.key}`}
                data-line=""
                d={pathFromPoints(pointsOf(si))}
                fill="none"
                stroke={chartColor(s.color)}
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
                  <circle key={`dot-${s.key}`} cx={px} cy={py} r={3.5} fill={chartColor(s.color)} stroke={SURFACE} strokeWidth={2} />
                )),
              )}
            {active !== null && (
              <g data-crosshair="">
                <line
                  x1={Math.round(x(active)) + 0.5}
                  x2={Math.round(x(active)) + 0.5}
                  y1={PAD_TOP}
                  y2={baseline}
                  stroke={AXIS}
                  strokeOpacity={0.55}
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                {series.map((s, si) => {
                  const v = valueAt(si, active);
                  if (v === undefined || !Number.isFinite(v)) return null;
                  return <circle key={s.key} cx={x(active)} cy={y(v)} r={4} fill={chartColor(s.color)} stroke={SURFACE} strokeWidth={2} />;
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
        headers={["Date", ...series.map((s) => s.label)]}
        rows={dates.map((_, di) => [dayAt(di), ...series.map((_, si) => formatted(valueAt(si, di)))])}
      />
    </div>
  );
}
