import { Eye, Leaf, Luggage } from "lucide-react";
import type { QuoteDetail, QuoteOption, QuoteVersion } from "../../api/quotes";
import { formatDuration, formatNumber, formatRelativeTime } from "../../lib/format";
import { formatMoney } from "../../lib/money";
import { Badge } from "../../ui/Badge";
import { cn } from "../../ui/cn";
import { EmptyState } from "../../ui/EmptyState";
import { Panel } from "../../ui/Panel";
import { ProvenanceBadge } from "../../ui/ProvenanceBadge";
import { cabinLabel } from "../pipeline/enquiryFacts";
import { journeyLine } from "./quoteText";
import { sellRange } from "./VersionHistory";

const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
/** "Fri 20 Nov" for an airport-local timestamp. */
const localDay = (iso: string) => DAY.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));

/**
 * One traveller's share of a party's sell price, rounded half-up to the minor unit: the figure the
 * client's page shows, which it shows only for adults-only parties (backend public_quotes.py).
 */
function perTraveller(option: QuoteOption): string {
  const share = Math.round(option.sell.amount_minor / option.offer.passenger_count);
  return formatMoney({ amount_minor: share, currency: option.sell.currency });
}

const PERCENT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function Figure({ label, value, hint, strong = false }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2">
      <dt className="tm-micro truncate">{label}</dt>
      <dd className={cn("tm-num truncate", strong ? "text-base font-semibold text-ink" : "text-[13px] text-ink")}>
        {value}
        {hint && <span className="ml-1 font-sans text-[11px] font-normal text-dim">{hint}</span>}
      </dd>
    </div>
  );
}

function OptionCard({ option, index, accepted, adultsOnly }: { option: QuoteOption; index: number; accepted: boolean; adultsOnly: boolean }) {
  const { offer } = option;
  const fareLine = [offer.cabin ? cabinLabel(offer.cabin) : null, offer.slices[0]?.fare_brand].filter(Boolean).join(" · ");
  const markupShare = offer.total.amount_minor > 0 ? (option.markup_minor / offer.total.amount_minor) * 100 : null;
  const travellers = offer.passenger_count;
  return (
    <li className={cn("@container rounded-[16px] border bg-card-2", accepted ? "border-ok/60" : "border-line")}>
      <div className="flex flex-wrap items-start gap-3 p-3">
        <span
          aria-hidden="true"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-line bg-surface font-mono text-xs font-semibold text-ink"
        >
          {offer.owner_carrier}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium leading-5 text-ink">
            <span className="tm-micro">Option {index + 1}</span>
            {offer.owner_name ?? offer.owner_carrier}
            <ProvenanceBadge provenance={offer.provenance} />
            {accepted && <Badge tone="ok">Accepted by the client</Badge>}
          </p>
          {fareLine && <p className="text-xs leading-4 text-dim">{fareLine}</p>}
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {offer.slices.map((slice, sliceIndex) => (
              <li key={sliceIndex} className="flex flex-wrap gap-x-2 font-mono text-xs leading-4 text-ink">
                {slice.segments[0] && <span className="text-dim">{localDay(slice.segments[0].departing_at)}</span>}
                <span>{journeyLine(slice)}</span>
                {slice.duration_minutes !== null && <span className="text-dim">{formatDuration(slice.duration_minutes)}</span>}
                <span className="font-sans text-faint">
                  {slice.segments.map((s) => `${s.marketing_carrier} ${s.flight_number}`).join(", ")}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-4 text-dim">
            {offer.baggage.checked !== null && (
              <span className="inline-flex items-center gap-1">
                <Luggage size={12} aria-hidden="true" className="text-faint" />
                {offer.baggage.checked === 0 ? "No checked bag" : `${offer.baggage.checked} checked bag${offer.baggage.checked > 1 ? "s" : ""}`}
              </span>
            )}
            {offer.conditions.refundable !== null && <span>{offer.conditions.refundable ? "Refundable" : "Non-refundable"}</span>}
            {offer.conditions.changeable !== null && <span>{offer.conditions.changeable ? "Changes allowed" : "No changes"}</span>}
            {offer.co2_kg_per_passenger !== null && (
              <span className="inline-flex items-center gap-1">
                <Leaf size={12} aria-hidden="true" className="text-faint" />
                {formatNumber(offer.co2_kg_per_passenger)} kg CO₂e per passenger
              </span>
            )}
          </p>
        </div>
      </div>
      {/* Sized by the card, not the screen: four across when the card is wide, two by two in the narrow column. */}
      <dl className="grid grid-cols-2 divide-line border-t border-line @lg:grid-cols-4 @lg:divide-x">
        <Figure label="Supplier fare" value={formatMoney(offer.total)} />
        <Figure label="Markup" value={formatMoney({ amount_minor: option.markup_minor, currency: option.sell.currency })} hint={markupShare !== null ? `${PERCENT.format(markupShare)}%` : undefined} />
        <Figure label="Sell" value={formatMoney(option.sell)} strong />
        {travellers > 1 && adultsOnly ? (
          <Figure label="Per traveller" value={perTraveller(option)} hint={`× ${travellers}`} />
        ) : (
          <Figure label="Travellers" value={String(travellers)} hint={travellers > 1 ? "total price only" : undefined} />
        )}
      </dl>
    </li>
  );
}

/**
 * A saved version as the server priced it: every option with its flights, supplier fare, markup, sell
 * price and per-traveller share, the totals and the message. Nothing here is computed from typed prices.
 */
export function VersionPreview({
  quote,
  version,
  author,
  adultsOnly,
  now,
  className,
}: {
  quote: QuoteDetail;
  version: QuoteVersion | undefined;
  author: string | undefined;
  /** Whether the enquiry's party is adults only; a per-traveller price is shown only then, as on the client's page. */
  adultsOnly: boolean;
  now: Date;
  className?: string;
}) {
  if (!version) {
    return (
      <Panel title="Preview" description="What the client will see, priced by TravelMind" className={className}>
        <EmptyState
          icon={Eye}
          title="Nothing to preview yet"
          description="Save a version to see each option's sell price, worked out from the supplier fare and your markup."
          className="py-5"
        />
      </Panel>
    );
  }
  const sent = version.version === quote.sent_version;
  const acceptedHere = quote.status === "accepted" && sent ? quote.accepted_option : null;
  return (
    <Panel
      title={`Version ${version.version} preview`}
      description={`Priced by TravelMind · saved ${formatRelativeTime(version.created_at, now)}${author ? ` by ${author}` : ""}`}
      actions={
        sent ? (
          <Badge tone="primary">Client sees this version</Badge>
        ) : quote.sent_version ? (
          <Badge tone="neutral">{`Client sees v${quote.sent_version}`}</Badge>
        ) : (
          <Badge tone="neutral">Not sent</Badge>
        )
      }
      className={className}
    >
      <div className="flex flex-col gap-3">
        <ol aria-label={`Options in version ${version.version}`} className="flex flex-col gap-2">
          {version.options.map((option, index) => (
            <OptionCard
              key={`${option.offer.id}-${index}`}
              option={option}
              index={index}
              accepted={acceptedHere === index}
              adultsOnly={adultsOnly}
            />
          ))}
        </ol>
        <div className="callout flex-col gap-1">
          <p className="tm-micro">Message</p>
          {version.message ? (
            <p className="whitespace-pre-wrap text-[13px] leading-5 text-ink">{version.message}</p>
          ) : (
            <p className="text-[13px] leading-5 text-faint">No message with this version</p>
          )}
        </div>
        <p className="text-xs leading-4 text-dim">
          {version.totals.options} option{version.totals.options === 1 ? "" : "s"} ·{" "}
          <span className="tm-num text-ink">{sellRange(version, quote.currency)}</span> · prices in {quote.currency} for all travellers,
          taxes included
        </p>
      </div>
    </Panel>
  );
}
