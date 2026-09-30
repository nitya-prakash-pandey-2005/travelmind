import { Equal, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import type { Baseline, Insight, Money } from "../../api/offers";
import { formatNumber } from "../../lib/format";
import { formatMoney } from "../../lib/money";
import { Badge } from "../../ui/Badge";
import { cn } from "../../ui/cn";
import { Panel } from "../../ui/Panel";
import { Readout } from "../../ui/Readout";

const MARKER = "Cheapest comparable fare (per traveller)";

const SIGNAL: Record<Insight["signal"], { icon: LucideIcon; className: string }> = {
  good: { icon: TrendingDown, className: "text-ok" },
  typical: { icon: Equal, className: "text-dim" },
  high: { icon: TrendingUp, className: "text-warn" },
};

/**
 * Where the cheapest comparable fare sits, per traveller, against the per-traveller fares seen for this
 * route and booking window: a bullet bar in three equal bands (below the 25th percentile, the typical
 * 25th–75th range, above the 75th), with the median ticked and the fare as a marker.
 */
export function FareInsight({ baseline, price: fare, insight }: { baseline: Baseline; price: Money | null; insight: Insight | null }) {
  // A fare the server couldn't convert into the baseline's currency can't be placed on its scale.
  const price = fare !== null && fare.currency === baseline.currency ? fare : null;
  const money = (minor: number) => formatMoney({ amount_minor: minor, currency: baseline.currency });
  const spread = Math.max(baseline.p75_minor - baseline.p25_minor, 1);
  const low = baseline.p25_minor - spread;
  const high = baseline.p75_minor + spread;
  const at = (minor: number) => Math.min(100, Math.max(0, ((minor - low) / (high - low)) * 100));
  const range = `a typical range of ${money(baseline.p25_minor)} to ${money(baseline.p75_minor)} per traveller`;
  const signal = insight ? SIGNAL[insight.signal] : null;
  const SignalIcon = signal?.icon;
  const sandbox = baseline.family === "sandbox";

  return (
    <Panel
      title="Fare insight"
      description={`Per-traveller fares seen on this route in the last ${baseline.window_days} days`}
      actions={<Badge tone={sandbox ? "warn" : "info"}>{sandbox ? "Sandbox data" : "Market data"}</Badge>}
    >
      <div className="grid items-start gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto]">
        <div className="flex min-w-0 flex-col gap-2">
          {insight && signal && SignalIcon ? (
            <p className="flex items-start gap-2 text-sm leading-5 text-ink">
              <SignalIcon size={16} aria-hidden="true" className={cn("mt-0.5 shrink-0", signal.className)} />
              <span>{insight.message}</span>
            </p>
          ) : (
            <p className="text-sm leading-5 text-dim">No fare in these results can be compared with the route's history yet.</p>
          )}
          {price && (
            <p className="flex items-center gap-2 text-xs leading-4 text-dim">
              <span aria-hidden="true" className="h-3 w-0.5 shrink-0 rounded-full bg-ink" />
              <span>
                {MARKER} <span className="tm-num text-ink">{formatMoney(price)}</span>
              </span>
            </p>
          )}
        </div>

        <div
          role="img"
          aria-label={price ? `${MARKER} ${formatMoney(price)} against ${range}` : `Fares on this route usually fall in ${range}`}
          className="relative min-w-0 pb-6 pt-5"
        >
          <div className="grid h-2 grid-cols-3 gap-0.5">
            <span className="rounded-l-full bg-ok/30" />
            <span className="bg-line-strong" />
            <span className="rounded-r-full bg-warn/30" />
          </div>
          <span
            className="absolute top-[18px] h-3 w-px -translate-x-1/2 bg-dim"
            style={{ left: `${at(baseline.median_minor)}%` }}
          />
          {price && (
            <>
              <span
                className="absolute top-[14px] h-5 w-0.5 -translate-x-1/2 rounded-full bg-ink ring-2 ring-surface"
                style={{ left: `${at(price.amount_minor)}%` }}
              />
              <span
                className="tm-num absolute top-0 -translate-x-1/2 whitespace-nowrap text-[11px] leading-4 text-ink"
                style={{ left: `${Math.min(88, Math.max(12, at(price.amount_minor)))}%` }}
              >
                {formatMoney(price)}
              </span>
            </>
          )}
          <div className="absolute inset-x-0 bottom-0 h-4 text-[11px] leading-4">
            <span className="absolute left-[16.67%] -translate-x-1/2 text-faint">Low</span>
            <span className="tm-num absolute left-1/3 -translate-x-1/2 text-dim">{money(baseline.p25_minor)}</span>
            <span className="absolute left-1/2 -translate-x-1/2 text-faint max-sm:hidden">Typical</span>
            <span className="tm-num absolute left-2/3 -translate-x-1/2 text-dim">{money(baseline.p75_minor)}</span>
            <span className="absolute left-[83.33%] -translate-x-1/2 text-faint">High</span>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-6 lg:w-64">
          <Readout
            label="Typical per traveller"
            value={money(baseline.median_minor)}
            hint={`Usual ${money(baseline.p25_minor)}–${money(baseline.p75_minor)}`}
          />
          <Readout label="Fares seen" value={formatNumber(baseline.sample_size)} hint={`Last ${baseline.window_days} days`} />
        </dl>
      </div>
      {sandbox && (
        <p className="mt-4 border-t border-line pt-3 text-xs text-dim">
          Built from sandbox searches. For demonstration only.
        </p>
      )}
    </Panel>
  );
}
