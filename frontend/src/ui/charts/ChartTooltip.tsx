export type TooltipRow = { key: string; label: string; value: string; color: string };

/**
 * Glassy readout that follows a chart's crosshair. `x` is in the chart's pixel space; the
 * tooltip sits to the right of it and flips to the left past 60% of the width so it never
 * overflows the chart. Values lead visually; each row is keyed by a short stroke of its series colour.
 */
export function ChartTooltip({
  id,
  x,
  width,
  top = 8,
  title,
  rows,
}: {
  id: string;
  x: number;
  width: number;
  top?: number;
  title: string;
  rows: TooltipRow[];
}) {
  const flip = x > width * 0.6;
  return (
    <div
      id={id}
      role="tooltip"
      className="tm-glass pointer-events-none absolute z-10 min-w-36 rounded-md border border-line px-3 py-2 text-xs"
      style={{ left: x, top, transform: flip ? "translateX(calc(-100% - 12px))" : "translateX(12px)" }}
    >
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-dim">{title}</p>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.key} className="grid grid-cols-[12px_1fr_auto] items-center gap-2">
            <span aria-hidden="true" className="h-0.5 w-3 rounded-full" style={{ background: row.color }} />
            <span className="truncate text-dim">{row.label}</span>
            <span className="text-right font-mono font-medium tabular-nums text-ink">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
