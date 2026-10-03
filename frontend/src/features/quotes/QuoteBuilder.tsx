import { CircleAlert, History, ListPlus, RefreshCw, Save, X } from "lucide-react";
import { useId, useState } from "react";
import { asApiError } from "../../api/client";
import { offersApi, type FlightOffer } from "../../api/offers";
import {
  MAX_QUOTE_MESSAGE,
  MAX_QUOTE_OPTIONS,
  useAddQuoteVersion,
  type QuoteDetail,
  type QuoteVersionCreate,
} from "../../api/quotes";
import { formatMoney } from "../../lib/money";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { cn } from "../../ui/cn";
import { EmptyState } from "../../ui/EmptyState";
import { Panel } from "../../ui/Panel";
import { ProvenanceBadge } from "../../ui/ProvenanceBadge";
import { FIELD_CONTROL, FIELD_LABEL } from "../../ui/TextField";
import { useToast } from "../../ui/toast/useToast";
import { markupInput, parseMarkup } from "./markup";
import { MarkupControls, MarkupInput } from "./MarkupControls";
import { journeyLine } from "./quoteText";

/** An offer chosen for the next version, with its own markup as typed ("" uses the version's markup). */
export type QuotePick = { offer: FlightOffer; markup: string };

const carrierName = (offer: FlightOffer) => offer.owner_name ?? offer.owner_carrier;

function errorOf(parsed: ReturnType<typeof parseMarkup>): string | null {
  return "error" in parsed ? parsed.error : null;
}

function valueOf(parsed: ReturnType<typeof parseMarkup>): number | null {
  return "value" in parsed ? parsed.value : null;
}

function PickRow({
  pick,
  index,
  quote,
  defaultText,
  error,
  disabled,
  onMarkup,
  onRemove,
}: {
  pick: QuotePick;
  index: number;
  quote: QuoteDetail;
  defaultText: string;
  error: string | null;
  disabled: boolean;
  onMarkup: (text: string) => void;
  onRemove: () => void;
}) {
  const { offer } = pick;
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] gap-x-3 gap-y-2 border-t border-line py-3 first:border-t-0 first:pt-0">
      <span
        aria-hidden="true"
        className="mt-0.5 grid h-6 w-6 place-items-center rounded-md border border-line bg-surface-2 font-mono text-[11px] font-semibold text-ink"
      >
        {index + 1}
      </span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-medium leading-5 text-ink">
          <span className="font-mono text-dim">{offer.owner_carrier}</span>
          {carrierName(offer)}
          <ProvenanceBadge provenance={offer.provenance} />
        </p>
        {offer.slices.map((slice, sliceIndex) => (
          <p key={sliceIndex} className="truncate font-mono text-[11px] leading-4 text-dim">
            {journeyLine(slice)}
          </p>
        ))}
        <p className="mt-1 text-xs leading-4 text-dim">
          Supplier fare <span className="tm-num text-ink">{formatMoney(offer.total)}</span>
          {offer.passenger_count > 1 && ` for ${offer.passenger_count} travellers`}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        aria-label={`Remove option ${index + 1}`}
        onClick={onRemove}
        disabled={disabled}
        className="-mr-1.5 -mt-1"
      >
        <X size={14} aria-hidden="true" />
      </Button>
      <MarkupInput
        label={`Markup for option ${index + 1}`}
        hideLabel
        kind={quote.markup_kind}
        currency={quote.currency}
        value={pick.markup}
        onChange={onMarkup}
        placeholder={defaultText ? `${defaultText} (default)` : "Default"}
        error={error}
        disabled={disabled}
        className="col-start-2 col-end-4 sm:max-w-56"
      />
    </li>
  );
}

type QuoteBuilderProps = {
  quote: QuoteDetail;
  picks: QuotePick[];
  onPicksChange: (picks: QuotePick[]) => void;
  /** Why the quote can't take a new version (closed quote or enquiry); null when it can. */
  lockedReason: string | null;
  /** Called with the new version's number once the server has priced and saved it. */
  onSaved: (version: number) => void;
  /** True while a re-price or save runs, so the offer picker can hold the selection still. */
  onBusyChange?: (busy: boolean) => void;
  className?: string;
};

/**
 * The next version: the chosen offers, the markup (for every option and per option) and the message.
 * Saving posts offer ids, the message and markups only; the server prices every option from its own
 * copy of the offer, and its answer is the preview. "Re-price and save" checks each fare with its
 * supplier first and saves the fresh offers.
 */
export function QuoteBuilder({ quote, picks, onPicksChange, lockedReason, onSaved, onBusyChange, className }: QuoteBuilderProps) {
  const { toast } = useToast();
  const messageId = useId();
  const counterId = useId();
  const addVersion = useAddQuoteVersion();
  const [defaultText, setDefaultText] = useState(() => markupInput(quote.markup_kind, quote.markup_value, quote.currency));
  const [message, setMessage] = useState(() => quote.versions[0]?.message ?? "");
  const [repricing, setRepricing] = useState(false);
  const latest = quote.versions[0];
  const next = quote.current_version + 1;

  const parsedDefault = parseMarkup(quote.markup_kind, defaultText, quote.currency);
  const defaultError = errorOf(parsedDefault);
  const parsedPicks = picks.map((pick) => parseMarkup(quote.markup_kind, pick.markup, quote.currency));
  const invalid = Boolean(defaultError) || parsedPicks.some((parsed) => errorOf(parsed) !== null) || message.length > MAX_QUOTE_MESSAGE;
  const busy = addVersion.isPending || repricing;
  const canSave = picks.length > 0 && !invalid && !lockedReason && !busy;

  function versionBody(offers: FlightOffer[]): QuoteVersionCreate {
    const fallback = valueOf(parsedDefault) ?? quote.markup_value;
    return {
      offer_ids: offers.map((offer) => offer.id),
      message: message.trim(),
      option_markups: parsedPicks.map((parsed) => valueOf(parsed) ?? fallback),
    };
  }

  function save(offers: FlightOffer[]) {
    onBusyChange?.(true);
    addVersion.mutate(
      { id: quote.id, version: versionBody(offers) },
      {
        onSuccess: (saved) => {
          toast({ tone: "ok", title: `Version ${saved.current_version} saved`, description: "Priced by TravelMind and ready to send." });
          onSaved(saved.current_version);
        },
        onError: (error) => toast({ tone: "danger", title: "Couldn't save the version", description: asApiError(error).message }),
        onSettled: () => onBusyChange?.(false),
      },
    );
  }

  async function repriceAndSave() {
    setRepricing(true);
    onBusyChange?.(true);
    const fresh: FlightOffer[] = [];
    const changes: string[] = [];
    for (const pick of picks) {
      try {
        const result = await offersApi.reprice(pick.offer.id);
        fresh.push(result.offer);
        if (result.price_changed) {
          changes.push(`${carrierName(result.offer)} is now ${formatMoney(result.offer.total)} (was ${formatMoney(result.previous_total)})`);
        }
      } catch (error) {
        setRepricing(false);
        onBusyChange?.(false);
        toast({ tone: "danger", title: `Couldn't re-price ${carrierName(pick.offer)}`, description: asApiError(error).message });
        return;
      }
    }
    setRepricing(false);
    onPicksChange(picks.map((pick, index) => ({ ...pick, offer: fresh[index] ?? pick.offer })));
    if (changes.length > 0) {
      toast({ tone: "warn", title: changes.length === 1 ? "Price changed" : `${changes.length} prices changed`, description: changes.join(" · ") });
    } else {
      toast({ tone: "ok", title: "Prices confirmed", description: `${picks.length === 1 ? "The option still costs" : `All ${picks.length} options still cost`} the same.` });
    }
    const otherCurrency = fresh.find((offer) => offer.total.currency !== quote.currency);
    if (otherCurrency) {
      toast({ tone: "danger", title: "Not saved", description: `${carrierName(otherCurrency)} is now billed in ${otherCurrency.total.currency}.` });
      onBusyChange?.(false);
      return;
    }
    save(fresh);
  }

  function reuseLatest() {
    if (!latest) return;
    onPicksChange(latest.options.map((option) => ({ offer: option.offer, markup: "" })));
  }

  return (
    <Panel
      title={`Build version ${next}`}
      description={`Up to ${MAX_QUOTE_OPTIONS} options. TravelMind prices each one from the supplier fare and your markup when you save.`}
      actions={<Badge tone={picks.length > 0 ? "primary" : "neutral"}>{`${picks.length}/${MAX_QUOTE_OPTIONS} selected`}</Badge>}
      className={className}
    >
      <div className="flex flex-col gap-4">
        {lockedReason && (
          <p role="note" className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-[13px] leading-5 text-warn">
            <CircleAlert size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
            {lockedReason}
          </p>
        )}

        {picks.length === 0 ? (
          <div className="rounded-md border border-dashed border-line-strong">
            <EmptyState
              icon={ListPlus}
              title="No options selected"
              description="Search fares and tick Add to quote on up to three offers."
              className="py-5"
            />
            {latest && !lockedReason && (
              <div className="-mt-2 flex justify-center pb-4">
                <Button variant="secondary" size="sm" onClick={reuseLatest}>
                  <History size={14} aria-hidden="true" />
                  Reuse options from v{latest.version}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <ol aria-label="Options in this version" className="flex flex-col">
            {picks.map((pick, index) => (
              <PickRow
                key={pick.offer.id}
                pick={pick}
                index={index}
                quote={quote}
                defaultText={defaultError ? "" : defaultText.trim()}
                error={errorOf(parsedPicks[index] ?? { value: null })}
                disabled={busy}
                onMarkup={(text) => onPicksChange(picks.map((p, i) => (i === index ? { ...p, markup: text } : p)))}
                onRemove={() => onPicksChange(picks.filter((_, i) => i !== index))}
              />
            ))}
          </ol>
        )}

        <div className="border-t border-line pt-4">
          <MarkupControls
            kind={quote.markup_kind}
            currency={quote.currency}
            value={defaultText}
            onChange={setDefaultText}
            error={defaultError}
            quoteDefault={quote.markup_value}
            disabled={busy}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={messageId} className={FIELD_LABEL}>
              Message to the client
            </label>
            <span
              id={counterId}
              className={cn("font-mono text-[11px] tabular-nums", message.length > MAX_QUOTE_MESSAGE ? "text-danger" : "text-faint")}
            >
              {message.length}/{MAX_QUOTE_MESSAGE}
            </span>
          </div>
          <textarea
            id={messageId}
            rows={3}
            value={message}
            disabled={busy}
            aria-describedby={counterId}
            aria-invalid={message.length > MAX_QUOTE_MESSAGE || undefined}
            placeholder="A short note shown above the options, e.g. both fares include a checked bag."
            onChange={(event) => setMessage(event.target.value)}
            className={cn(FIELD_CONTROL, "h-auto resize-y border-line-strong py-2 leading-5")}
          />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
          <p className="mr-auto text-xs leading-4 text-dim">
            {picks.length === 0 ? "Select at least one offer to save a version." : "Sell prices appear in the preview after saving."}
          </p>
          <Button variant="secondary" size="sm" onClick={() => void repriceAndSave()} disabled={!canSave} loading={repricing}>
            {!repricing && <RefreshCw size={14} aria-hidden="true" />}
            Re-price and save
          </Button>
          <Button size="sm" onClick={() => save(picks.map((pick) => pick.offer))} disabled={!canSave} loading={addVersion.isPending}>
            {!addVersion.isPending && <Save size={14} aria-hidden="true" />}
            Save version
          </Button>
        </div>
      </div>
    </Panel>
  );
}
