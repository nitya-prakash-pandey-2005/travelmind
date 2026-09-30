import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { cn } from "../cn";
import { Skeleton } from "../Skeleton";
import { Sparkline } from "./Sparkline";

export type KpiDelta = { pct: number | null; direction: "up" | "down" | "flat"; good: boolean };

const ARROW = { up: ArrowUpRight, down: ArrowDownRight, flat: ArrowRight };

function deltaTone(delta: KpiDelta): string {
  if (delta.pct === null || delta.direction === "flat") return "text-dim";
  return delta.good ? "text-ok" : "text-danger";
}

function deltaPhrase(delta: KpiDelta): string {
  if (delta.pct === null) return "no earlier period to compare";
  if (delta.direction === "flat") return "unchanged";
  return `${delta.direction} ${Math.round(Math.abs(delta.pct))}%`;
}

function DeltaChip({ delta }: { delta: KpiDelta }) {
  const Arrow = ARROW[delta.direction];
  return (
    <span
      data-delta=""
      className={cn(
        "tm-tint inline-flex items-center gap-0.5 rounded-sm border px-1.5 py-0.5 font-mono text-xs tabular-nums",
        deltaTone(delta),
      )}
    >
      {delta.pct !== null && <Arrow size={12} aria-hidden="true" />}
      {delta.pct === null ? "—" : `${Math.round(Math.abs(delta.pct))}%`}
    </span>
  );
}

/**
 * Headline metric: label, value (mono), optional unit, change chip coloured by whether the move
 * is good, optional trend sparkline. `loading` shows skeletons and marks the tile busy.
 */
export function KpiTile({
  label,
  value,
  unit,
  delta,
  series,
  loading = false,
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  delta?: KpiDelta;
  series?: number[];
  loading?: boolean;
  hint?: string;
}) {
  const summary =
    loading || !value ? label : `${label}: ${value}${unit ? ` ${unit}` : ""}${delta ? `, ${deltaPhrase(delta)}` : ""}`;
  return (
    <div
      role="group"
      aria-label={summary}
      aria-busy={loading || undefined}
      className="tm-glass tm-edge relative flex min-w-0 flex-col gap-2 rounded-md p-4"
    >
      <p className="truncate font-mono text-[11px] uppercase tracking-[0.22em] text-dim">{label}</p>
      {loading ? (
        <>
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-full" />
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-mono text-2xl tabular-nums text-ink">{value}</span>
            {unit && <span className="text-sm text-dim">{unit}</span>}
            {delta && (
              <span className="ml-auto self-center">
                <DeltaChip delta={delta} />
              </span>
            )}
          </div>
          {series && series.length > 0 && <Sparkline label={`${label} trend`} values={series} />}
          {hint && <p className="text-xs text-dim">{hint}</p>}
        </>
      )}
    </div>
  );
}
