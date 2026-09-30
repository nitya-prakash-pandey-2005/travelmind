import type { Baseline, Insight, Money } from "../../api/offers";
import { formatNumber } from "../../lib/format";
import { formatMoney } from "../../lib/money";
import { cn } from "../../ui/cn";
import { Panel } from "../../ui/Panel";
import { Readout } from "../../ui/Readout";

const MARKER = "Cheapest comparable fare (per traveller)";
const INSIGHT_TONE: Record<Insight["signal"], string> = { good: "text-ok", typical: "text-ink", high: "text-warn" };

/**
 * Where the cheapest comparable fare sits, per traveller, against the per-traveller fares seen for
 * this route and booking window.
 */
export function FareGauge({ baseline, price: fare, insight }: { baseline: Baseline; price: Money | null; insight: Insight | null }) {
  // A fare the server couldn't convert into the baseline's currency can't be placed on its scale.
  const price = fare !== null && fare.currency === baseline.currency ? fare : null;
  const money = (minor: number) => formatMoney({ amount_minor: minor, currency: baseline.currency });
  const spread = Math.max(baseline.p75_minor - baseline.p25_minor, 1);
  const low = baseline.p25_minor - spread;
  const high = baseline.p75_minor + spread;
  const at = (minor: number) => Math.min(100, Math.max(0, ((minor - low) / (high - low)) * 100));
  const range = `a typical range of ${money(baseline.p25_minor)} to ${money(baseline.p75_minor)} per traveller`;

  return (
    <Panel eyebrow="Fare intelligence" title="Price check">
      <div
        role="img"
        aria-label={price ? `${MARKER} ${formatMoney(price)} against ${range}` : `Fares on this route usually fall in ${range}`}
        className="relative h-3 overflow-visible rounded-sm bg-void/60"
      >
        <span className="absolute inset-y-0 left-0 bg-ok/30" style={{ width: `${at(baseline.p25_minor)}%` }} />
        <span
          className="absolute inset-y-0 bg-primary/25"
          style={{ left: `${at(baseline.p25_minor)}%`, width: `${at(baseline.p75_minor) - at(baseline.p25_minor)}%` }}
        />
        <span className="absolute inset-y-0 right-0 bg-warn/25" style={{ left: `${at(baseline.p75_minor)}%` }} />
        {price && (
          <span className="tm-glow absolute -top-1 h-5 w-0.5 bg-ink" style={{ left: `${at(price.amount_minor)}%` }} />
        )}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3">
        <Readout
          label="Typical per traveller"
          value={money(baseline.median_minor)}
          hint={`Usual ${money(baseline.p25_minor)}–${money(baseline.p75_minor)}`}
        />
        <Readout label="Fares seen" value={formatNumber(baseline.sample_size)} hint={`Last ${baseline.window_days} days`} />
      </dl>
      {price && (
        <p className="mt-3 text-xs text-dim">
          {MARKER} <span className="font-mono text-ink">{formatMoney(price)}</span>
        </p>
      )}
      {insight && <p className={cn("mt-3 text-sm", INSIGHT_TONE[insight.signal])}>{insight.message}</p>}
      {baseline.family === "sandbox" && (
        <p className="mt-2 text-xs text-dim">Built from sandbox searches — for demonstration only.</p>
      )}
    </Panel>
  );
}
