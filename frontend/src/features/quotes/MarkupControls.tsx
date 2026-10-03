import { useId } from "react";
import type { MarkupKind } from "../../api/quotes";
import { cn } from "../../ui/cn";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { FIELD_CONTROL, FIELD_LABEL, FieldMessage } from "../../ui/TextField";
import { describeMarkup } from "./markup";

const SYMBOLS = new Map<string, string>();

/** "₹" for INR, "$" for USD: the currency's narrow symbol, or its code. */
function currencySymbol(currency: string): string {
  let symbol = SYMBOLS.get(currency);
  if (!symbol) {
    const parts = new Intl.NumberFormat("en-IN", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).formatToParts(0);
    symbol = parts.find((part) => part.type === "currency")?.value ?? currency;
    SYMBOLS.set(currency, symbol);
  }
  return symbol;
}

type MarkupInputProps = {
  label: string;
  /** Keep the label for screen readers only (a row of options already says what the field is). */
  hideLabel?: boolean;
  kind: MarkupKind;
  currency: string;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  error?: string | null;
  hint?: string;
  disabled?: boolean;
  className?: string;
};

/** A markup amount: "%" after a percentage, the currency symbol before a fixed amount. */
export function MarkupInput({ label, hideLabel = false, kind, currency, value, onChange, placeholder, error, hint, disabled, className }: MarkupInputProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? hint;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : FIELD_LABEL}>
        {label}
      </label>
      <div className="relative">
        {kind === "fixed" && (
          <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[13px] text-dim">
            {currencySymbol(currency)}
          </span>
        )}
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            FIELD_CONTROL,
            "font-mono tabular-nums",
            kind === "fixed" ? "pl-7 pr-3" : "pl-3 pr-7",
            error ? "border-danger hover:border-danger" : "border-line-strong",
          )}
        />
        {kind === "percent" && (
          <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[13px] text-dim">
            %
          </span>
        )}
      </div>
      {message && (
        <FieldMessage id={messageId} error={Boolean(error)}>
          {message}
        </FieldMessage>
      )}
    </div>
  );
}

const KINDS = [
  { value: "percent", label: "Percent" },
  { value: "fixed", label: "Fixed amount" },
] as const;

/**
 * The version's markup: its type (fixed for the quote when it was created) and the amount added to
 * every option that has no markup of its own. Percentages are sent as basis points, fixed amounts as
 * minor units; the server applies them.
 */
export function MarkupControls({
  kind,
  currency,
  value,
  onChange,
  error,
  quoteDefault,
  disabled = false,
}: {
  kind: MarkupKind;
  currency: string;
  value: string;
  onChange: (text: string) => void;
  error: string | null;
  /** The quote's own markup, in API units. */
  quoteDefault: number;
  disabled?: boolean;
}) {
  const kindHint = useId();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <span className={FIELD_LABEL}>Markup type</span>
        <SegmentedControl
          label="Markup type"
          options={KINDS}
          value={kind}
          onChange={() => undefined}
          disabled
          describedBy={kindHint}
        />
        <p id={kindHint} className="w-full text-xs leading-4 text-dim">
          Set when the quote was created; it applies to every version.
        </p>
      </div>
      <MarkupInput
        label="Markup for every option"
        kind={kind}
        currency={currency}
        value={value}
        onChange={onChange}
        placeholder="0"
        error={error}
        disabled={disabled}
        hint={`Quote default ${describeMarkup(kind, quoteDefault, currency)}${
          kind === "percent" ? " of each supplier fare" : ` added to each option, in ${currency}`
        }. An option's own markup replaces it.`}
      />
    </div>
  );
}
