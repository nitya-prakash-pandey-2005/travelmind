import { useState, type ReactNode } from "react";
import { formatNumber } from "../../lib/format";
import { ChartDataTable, useChartAnimation, useChartColors, type ChartColor, type ChartColors } from "./shared";

export type DonutSlice = { label: string; value: number };

const SIZE = 120;
const RADIUS = 48;
const RING = 14;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// Surface gap between neighbouring slices, in viewBox units (~2px at the rendered size).
const GAP = 2;
const MAX_SLICES = 6;

/** At most six slices: beyond that the five largest stay and the rest fold into "Other". */
function fold(slices: DonutSlice[]): DonutSlice[] {
  if (slices.length <= MAX_SLICES) return slices;
  const sorted = [...slices].sort((a, b) => b.value - a.value);
  const rest = sorted.slice(MAX_SLICES - 1).reduce((sum, s) => sum + s.value, 0);
  return [...sorted.slice(0, MAX_SLICES - 1), { label: "Other", value: rest }];
}

function sliceColor(colors: ChartColors, index: number): string {
  return colors.series((index + 1) as ChartColor);
}

function share(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

/** Part-to-whole ring with a legend of shares. Hovering a slice or legend row shows it in the centre. */
export function Donut({
  slices,
  label,
  center,
  valueFormat = formatNumber,
}: {
  slices: DonutSlice[];
  label: string;
  center?: ReactNode;
  valueFormat?: (value: number) => string;
}) {
  const animate = useChartAnimation();
  const colors = useChartColors();
  const [active, setActive] = useState<number | null>(null);
  const shown = fold(slices.map((s) => ({ ...s, value: Number.isFinite(s.value) ? Math.max(0, s.value) : 0 })));
  const total = shown.reduce((sum, s) => sum + s.value, 0);
  const gap = shown.filter((s) => s.value > 0).length > 1 ? GAP : 0;

  const lengths = shown.map((slice) => (total > 0 ? (slice.value / total) * CIRCUMFERENCE : 0));
  const arcs = shown.map((slice, i) => ({
    slice,
    dash: Math.max(0, (lengths[i] ?? 0) - gap),
    offset: lengths.slice(0, i).reduce((sum, length) => sum + length, 0),
    color: sliceColor(colors, i),
  }));

  const summary = total > 0 ? shown.map((s) => `${s.label} ${share(s.value, total)}%`).join(", ") : "no data";
  const focus = active === null ? null : shown[active];

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-5">
      <div role="img" aria-label={`${label}: ${summary}`} className="relative h-34 w-34 shrink-0">
        <svg aria-hidden="true" viewBox={`0 0 ${SIZE} ${SIZE}`} width="100%" height="100%" className="block -rotate-90">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke={colors.grid} strokeWidth={RING} />
          <g data-animate={animate ? "" : undefined} className={animate ? "tm-fade-in" : undefined}>
            {arcs.map((arc, i) =>
              arc.dash > 0 ? (
                <circle
                  key={`${arc.slice.label}-${i}`}
                  data-slice=""
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={RADIUS}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth={RING}
                  strokeDasharray={`${arc.dash.toFixed(2)} ${(CIRCUMFERENCE - arc.dash).toFixed(2)}`}
                  strokeDashoffset={(-arc.offset).toFixed(2)}
                  strokeOpacity={active === null || active === i ? 1 : 0.3}
                  className="transition-[stroke-opacity] duration-200"
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                />
              ) : null,
            )}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          {focus ? (
            <div className="flex max-w-20 flex-col items-center">
              <span className="font-mono text-lg tabular-nums text-ink">{share(focus.value, total)}%</span>
              <span className="truncate text-[11px] text-dim">{focus.label}</span>
            </div>
          ) : (
            (center ?? (
              <div className="flex flex-col items-center">
                <span className="font-mono text-lg tabular-nums text-ink">{valueFormat(total)}</span>
                <span className="tm-micro">Total</span>
              </div>
            ))
          )}
        </div>
      </div>
      <ul aria-label={`${label} legend`} className="flex min-w-40 flex-1 flex-col gap-1.5">
        {shown.map((slice, i) => (
          <li
            key={`${slice.label}-${i}`}
            className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2 rounded-sm px-1 text-sm"
            onPointerEnter={() => setActive(i)}
            onPointerLeave={() => setActive(null)}
          >
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px]" style={{ background: sliceColor(colors, i) }} />
            <span className="truncate text-ink">{slice.label}</span>
            <span className="font-mono text-xs tabular-nums text-dim">{`${share(slice.value, total)}%`}</span>
          </li>
        ))}
      </ul>
      <ChartDataTable
        caption={`${label} data`}
        headers={["Segment", "Value", "Share"]}
        rows={shown.map((s) => [s.label, valueFormat(s.value), `${share(s.value, total)}%`])}
      />
    </div>
  );
}
