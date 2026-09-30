import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { marketPulseQueryOptions, type MarketPulseRoute, type Provenance } from "../../api/dashboard";
import { formatNumber } from "../../lib/format";
import { formatMoney } from "../../lib/money";
import { Badge } from "../../ui/Badge";
import { Sparkline, type SparklineTone } from "../../ui/charts";
import { EmptyState } from "../../ui/EmptyState";
import { Panel } from "../../ui/Panel";
import { PanelSkeleton } from "../../ui/Skeleton";
import { cn } from "../../ui/cn";
import { formatChange, routeLabel } from "./format";
import { ErrorPanel } from "./PanelError";

const TITLE = "Market pulse";
const EYEBROW = "Fare movers · per traveller";

/** Where the fares behind a trend came from. Sandbox fares are test data and never bookable. */
const PROVENANCE: Record<Provenance, { tone: "ok" | "ai" | "warn"; label: string }> = {
  LIVE: { tone: "ok", label: "Live" },
  SANDBOX: { tone: "ai", label: "Sandbox" },
  MIXED: { tone: "warn", label: "Mixed" },
};

/** Moves under 2 % either way read as steady. Falling fares are good news for the traveller. */
function signal(change: number): { label: string; text: string; tone: SparklineTone | "dim" } {
  if (change >= 2) return { label: "Rising", text: "text-warn", tone: "warn" };
  if (change <= -2) return { label: "Falling", text: "text-ok", tone: "ok" };
  return { label: "Steady", text: "text-dim", tone: "dim" };
}

function PulseRow({ route, currency }: { route: MarketPulseRoute; currency: string }) {
  const move = signal(route.change_pct);
  const weekly = route.weekly.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const name = routeLabel(route.origin, route.destination);
  const provenance = PROVENANCE[route.provenance] ?? PROVENANCE.MIXED;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b border-line/60 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_5.5rem_auto]">
      <div className="min-w-0">
        <p className="font-mono text-sm text-ink">{name}</p>
        <p className="flex items-center gap-2 text-[11px] text-dim">
          <span>{formatNumber(route.samples)} fares</span>
          <Badge tone={provenance.tone}>{provenance.label}</Badge>
        </p>
      </div>
      <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
        {weekly.length > 1 ? (
          <Sparkline values={weekly} label={`${name} weekly median fare`} tone={move.tone === "dim" ? "primary" : move.tone} height={28} />
        ) : (
          <p className="font-mono text-[11px] text-dim">One week of data</p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="font-mono text-sm tabular-nums text-ink">
          {formatMoney({ amount_minor: route.current_minor, currency })}
        </span>
        <span
          className={cn("tm-tint inline-flex items-center gap-1 rounded-sm border px-1.5 py-px font-mono text-[11px] tabular-nums", move.text)}
        >
          {formatChange(route.change_pct)}
          <span className="sr-only">, {move.label.toLowerCase()} week on week</span>
        </span>
      </div>
    </li>
  );
}

export function MarketPulsePanel({ className }: { className?: string }) {
  const pulse = useQuery(marketPulseQueryOptions);

  if (pulse.isPending) return <PanelSkeleton title={TITLE} eyebrow={EYEBROW} className={className} />;
  if (pulse.isError) {
    return (
      <ErrorPanel
        title={TITLE}
        eyebrow={EYEBROW}
        error={pulse.error}
        onRetry={() => void pulse.refetch()}
        retrying={pulse.isFetching}
        className={className}
      />
    );
  }

  const { routes, currency } = pulse.data;
  return (
    <Panel variant="glass" title={TITLE} eyebrow={EYEBROW} className={className}>
      {routes.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title="No fare trends yet"
          description="Run fare scans on your routes — trends appear after two weeks of searches."
          action={{ label: "Run a fare scan", to: "/app/fares" }}
        />
      ) : (
        <>
          <ul aria-label="Routes with the biggest fare moves">
            {routes.map((route) => (
              <PulseRow key={`${route.origin}-${route.destination}`} route={route} currency={currency} />
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-dim">Median fare this week vs the four weeks before.</p>
        </>
      )}
    </Panel>
  );
}
