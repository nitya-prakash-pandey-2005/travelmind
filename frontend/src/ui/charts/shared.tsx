import { useReducedMotion } from "../useReducedMotion";

/** Slot in the categorical chart palette (`--color-chart-1..6`), assigned in fixed order. */
export type ChartColor = 1 | 2 | 3 | 4 | 5 | 6;

export function chartColor(slot: ChartColor): string {
  return `var(--color-chart-${slot})`;
}

export const GRID = "var(--color-chart-grid)";
export const AXIS = "var(--color-chart-axis)";
/** Surface colour for the 2px ring around markers and the gap between touching marks. */
export const SURFACE = "var(--color-surface)";

/** Charts measure their container; before the first measurement (and in tests) they draw at this width. */
export const FALLBACK_WIDTH = 640;

/** True for a plottable number: not null, undefined, NaN or ±Infinity. */
export function isValue(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Formats a plottable number, or "—" for a gap (null, undefined, NaN, ±Infinity). */
export function formatValue(value: number | null | undefined, format: (value: number) => string): string {
  return isValue(value) ? format(value) : "—";
}

/** Entrance animation is on unless the user prefers reduced motion. */
export function useChartAnimation(): boolean {
  return !useReducedMotion();
}

/** Percentage for SVG geometry, clamped to 0–100 and trimmed to 2 decimals. */
export function percent(value: number, max: number): string {
  if (!(max > 0) || !Number.isFinite(max) || !Number.isFinite(value)) return "0%";
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return `${Math.round(pct * 100) / 100}%`;
}

/** Visually hidden data table: the screen-reader view of a chart. */
export function ChartDataTable({ caption, headers, rows }: { caption: string; headers: string[]; rows: string[][] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {headers.map((header) => (
            <th key={header} scope="col">
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, r) => (
          <tr key={r}>
            {row.map((cell, c) =>
              c === 0 ? (
                <th key={c} scope="row">
                  {cell}
                </th>
              ) : (
                <td key={c}>{cell}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Placeholder for a chart with nothing to plot. */
export function ChartEmpty({ label, height }: { label: string; height: number }) {
  return (
    <div
      role="img"
      aria-label={`${label}: no data`}
      className="grid place-items-center rounded-md border border-dashed border-line text-xs text-dim"
      style={{ height }}
    >
      No data for this period
    </div>
  );
}
