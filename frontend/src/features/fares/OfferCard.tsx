import { useMutation } from "@tanstack/react-query";
import { asApiError } from "../../api/client";
import { offersApi, type FlightOffer, type Insight, type Provenance, type Slice } from "../../api/offers";
import { dayShift, localTime } from "../../lib/dates";
import { formatDuration, formatNumber } from "../../lib/format";
import { formatMoney } from "../../lib/money";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";

const PROVENANCE: Record<Provenance, { tone: "ok" | "warn" | "ai"; label: string }> = {
  LIVE: { tone: "ok", label: "Live" },
  CACHED: { tone: "warn", label: "Cached · indicative" },
  SANDBOX: { tone: "ai", label: "Sandbox · not bookable" },
};

const INSIGHT: Record<Insight["signal"], { tone: "ok" | "neutral" | "warn"; label: string }> = {
  good: { tone: "ok", label: "Good price" },
  typical: { tone: "neutral", label: "Typical price" },
  high: { tone: "warn", label: "High price" },
};

const CO2_SOURCE = {
  google_tim: "Google Travel Impact Model, this flight",
  google_tim_typical: "Google Travel Impact Model, typical for this route",
  supplier: "Supplier estimate",
} as const;

export function stopsLabel(slice: Slice): string {
  const vias = slice.segments.slice(0, -1).map((s) => s.destination);
  if (vias.length === 0) return "Nonstop";
  return `${vias.length} stop${vias.length > 1 ? "s" : ""} · ${vias.join(", ")}`;
}

function SliceRow({ slice }: { slice: Slice }) {
  const first = slice.segments[0];
  const last = slice.segments[slice.segments.length - 1];
  if (!first || !last) return null;
  const shift = dayShift(first.departing_at, last.arriving_at);
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
      <p className="font-mono text-lg text-ink">
        {localTime(first.departing_at)} <span className="text-xs text-dim">{slice.origin}</span>
      </p>
      <div className="flex flex-col items-center gap-0.5 text-[11px] text-dim">
        <span>{slice.duration_minutes !== null ? formatDuration(slice.duration_minutes) : "—"}</span>
        <span aria-hidden="true" className="h-px w-full bg-line" />
        <span>{stopsLabel(slice)}</span>
      </div>
      <p className="font-mono text-lg text-ink">
        {localTime(last.arriving_at)}
        {shift > 0 && <sup className="text-warn">+{shift}</sup>} <span className="text-xs text-dim">{slice.destination}</span>
      </p>
      <p className="col-span-3 text-[11px] text-dim">
        {slice.segments.map((s) => `${s.marketing_carrier} ${s.flight_number}`).join(" · ")}
        {slice.fare_brand ? ` · ${slice.fare_brand}` : ""}
      </p>
    </div>
  );
}

export function OfferCard({ offer }: { offer: FlightOffer }) {
  const reprice = useMutation({ mutationFn: () => offersApi.reprice(offer.id) });
  const carrier = offer.owner_name ?? offer.owner_carrier;
  const shown = offer.display_total ?? offer.total;
  const converted = offer.display_total !== null && offer.display_total.currency !== offer.total.currency;
  const price = formatMoney(shown);
  const { checked } = offer.baggage;

  return (
    <article aria-label={`${carrier} ${price}`} className="rounded-sm border border-line bg-void/40 p-4 transition hover:border-primary/50">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2">
            <span className="font-mono text-primary">{offer.owner_carrier}</span>
            <span className="text-ink">{carrier}</span>
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge tone={PROVENANCE[offer.provenance].tone}>{PROVENANCE[offer.provenance].label}</Badge>
            {offer.insight && <Badge tone={INSIGHT[offer.insight.signal].tone}>{INSIGHT[offer.insight.signal].label}</Badge>}
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl text-ink">{converted ? `≈ ${price}` : price}</p>
          {converted && <p className="text-xs text-dim">Billed {formatMoney(offer.total)}</p>}
          {offer.passenger_count > 1 && <p className="text-xs text-dim">Total for {offer.passenger_count} travellers</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-3">
        {offer.slices.map((slice, index) => (
          <SliceRow key={`${slice.origin}-${slice.destination}-${index}`} slice={slice} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-xs text-dim">
        <span className="flex flex-wrap gap-3">
          {offer.co2_kg_per_passenger !== null && (
            <span title={CO2_SOURCE[offer.co2_source ?? "supplier"]}>
              {formatNumber(offer.co2_kg_per_passenger)} kg CO₂e
            </span>
          )}
          {checked !== null && <span>{checked > 0 ? `${checked} checked bag${checked > 1 ? "s" : ""}` : "No checked bag"}</span>}
          {offer.conditions.refundable !== null && (
            <span>{offer.conditions.refundable ? "Refundable" : "Non-refundable"}</span>
          )}
        </span>
        <Button variant="ghost" size="sm" loading={reprice.isPending} onClick={() => reprice.mutate()}>
          Verify price
        </Button>
      </div>
      {reprice.isSuccess &&
        (reprice.data.price_changed ? (
          <p role="status" className="mt-2 text-sm text-warn">
            {`Price changed · now ${formatMoney(reprice.data.offer.total)} (was ${formatMoney(reprice.data.previous_total)})`}
          </p>
        ) : (
          <p role="status" className="mt-2 text-sm text-ok">
            {`Price confirmed · ${formatMoney(reprice.data.offer.total)}`}
          </p>
        ))}
      {reprice.isError && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {asApiError(reprice.error).message}
        </p>
      )}
    </article>
  );
}
