import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { cn } from "../cn";
import { Skeleton } from "../Skeleton";
import { useInKpiStrip } from "./KpiStrip";
import { Sparkline } from "./Sparkline";

/**
 * Change against the previous period: `pct` is a relative change in percent, or, with `points`, the
 * difference between two rates in percentage points.
 */
export type KpiDelta = { pct: number | null; direction: "up" | "down" | "flat"; good: boolean; points?: boolean };

const POINTS = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/** "8.3 pts" for a rate's change, "20%" for a relative one. */
function deltaAmount(delta: KpiDelta & { pct: number }): string {
  const size = Math.abs(delta.pct);
  return delta.points ? `${POINTS.format(size)} pts` : `${Math.round(size)}%`;
}

const ARROW = { up: ArrowUpRight, down: ArrowDownRight, flat: ArrowRight };

/** A non-finite change (NaN, ±Infinity from a zero base) reads as "no comparison". */
function normalise(delta: KpiDelta): KpiDelta {
  return delta.pct !== null && !Number.isFinite(delta.pct) ? { ...delta, pct: null } : delta;
}

function deltaTone(delta: KpiDelta): string {
  if (delta.pct === null || delta.direction === "flat") return "text-dim";
  return delta.good ? "text-ok" : "text-danger";
}

function deltaPhrase(delta: KpiDelta): string {
  if (delta.pct === null) return "no earlier period to compare";
  if (delta.direction === "flat") return "unchanged";
  if (delta.points) return `${delta.direction} ${POINTS.format(Math.abs(delta.pct))} percentage points`;
  return `${delta.direction} ${Math.round(Math.abs(delta.pct))}%`;
}

function DeltaChip({ delta: raw }: { delta: KpiDelta }) {
  const delta = normalise(raw);
  const Arrow = ARROW[delta.direction];
  return (
    <span
      data-delta=""
      className={cn("badge tone-fill gap-0.5 px-2 py-0.5 font-mono text-[11px] font-medium leading-4 tabular-nums", deltaTone(delta))}
    >
      {delta.pct !== null && <Arrow size={12} strokeWidth={2} aria-hidden="true" />}
      {delta.pct === null ? "—" : deltaAmount({ ...delta, pct: delta.pct })}
    </span>
  );
}

/**
 * Headline metric as the kit's Stat: HUD label, big Space Grotesk value, optional unit, a delta badge coloured by
 * whether the move is good, a caption (`hint`, e.g. "vs previous 30 days") and an optional sparkline. `loading`
 * shows skeletons sized like the content and marks the tile busy. A glass card of its own, in a strip or alone.
 */
export function KpiTile({
  label,
  value,
  unit,
  delta,
  series,
  trendLabel,
  loading = false,
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  delta?: KpiDelta;
  series?: number[];
  /** What the sparkline plots ("New enquiries per day"): shown under it and used as its name. */
  trendLabel?: string;
  loading?: boolean;
  hint?: string;
}) {
  const inStrip = useInKpiStrip();
  const summary =
    loading || !value ? label : `${label}: ${value}${unit ? ` ${unit}` : ""}${delta ? `, ${deltaPhrase(normalise(delta))}` : ""}`;
  return (
    <div
      role="group"
      aria-label={summary}
      aria-busy={loading || undefined}
      className={cn(
        "card stat relative flex min-w-0 flex-col gap-1.5",
        inStrip ? "px-4 py-3.5" : "p-[18px]",
      )}
    >
      <p className="tm-micro truncate">{label}</p>
      {loading ? (
        <>
          <Skeleton className="my-[3px] h-8 w-24" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-full" />
        </>
      ) : (
        <>
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <span className="v text-[30px] leading-[38px]">{value}</span>
            {unit && <span className="text-[13px] text-dim">{unit}</span>}
          </div>
          {(delta || hint) && (
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              {delta && <DeltaChip delta={delta} />}
              {hint && <p className="min-w-0 truncate text-xs text-dim">{hint}</p>}
            </div>
          )}
          {series && series.length > 0 && (
            <div className="mt-1.5">
              <Sparkline label={trendLabel ?? `${label} trend`} values={series} />
              {trendLabel && <p className="mt-1 truncate text-[11px] leading-4 text-faint">{trendLabel}</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
