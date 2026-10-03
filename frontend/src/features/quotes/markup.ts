import { MAX_FIXED_MINOR, MAX_PERCENT_BP, type MarkupKind } from "../../api/quotes";
import { currencyExponent, formatMoney } from "../../lib/money";

/**
 * Markup as agents type it and as the API takes it: a percentage ("8.5") is sent in basis points
 * (850); a fixed amount in major units ("500") is sent in minor units of the quote currency (50000).
 * Parsing is done on the digits, never with floating-point arithmetic.
 */

export type ParsedMarkup = { value: number | null } | { error: string };

const DECIMAL = /^(\d+)(?:\.(\d*))?$|^\.(\d+)$/;
/** Grouping commas: Western "1,250,000" or Indian "12,50,000". */
const THOUSANDS = /^(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d*)?$/;
/** Percent markups are typed with up to this many decimals (basis points). */
const PERCENT_DIGITS = 2;

function digitsFor(kind: MarkupKind, currency: string): number {
  return kind === "percent" ? PERCENT_DIGITS : currencyExponent(currency);
}

/** Text typed into a markup field → its API value; blank is `null` (use the default). */
export function parseMarkup(kind: MarkupKind, text: string, currency: string): ParsedMarkup {
  const trimmed = text.trim();
  if (trimmed === "") return { value: null };
  // Commas only as digit grouping ("1,250", "1,25,000"); "8,5" is a decimal comma, not 85.
  if (trimmed.includes(",") && !THOUSANDS.test(trimmed)) return { error: "Use a dot for decimals, like 8.5." };
  const clean = trimmed.replace(/,/g, "");
  const match = DECIMAL.exec(clean);
  if (!match) return { error: kind === "percent" ? "Enter a number, like 8.5." : "Enter an amount, like 500." };
  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? match[3] ?? "").replace(/0+$/, "");
  const digits = digitsFor(kind, currency);
  if (fraction.length > digits) {
    return { error: digits === 0 ? "Whole amounts only." : `Up to ${digits} decimal place${digits === 1 ? "" : "s"}.` };
  }
  const max = kind === "percent" ? MAX_PERCENT_BP : MAX_FIXED_MINOR;
  const tooLarge = kind === "percent" ? "Up to 100%." : `Up to ${formatMoney({ amount_minor: MAX_FIXED_MINOR, currency })}.`;
  if (whole.replace(/^0+/, "").length > 12) return { error: tooLarge };
  const value = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
  return value > max ? { error: tooLarge } : { value };
}

/** An API value → the text an agent would type: 850 bp → "8.5", 25050 paise → "250.5". */
export function markupInput(kind: MarkupKind, value: number, currency: string): string {
  const digits = digitsFor(kind, currency);
  const scale = 10 ** digits;
  const whole = Math.floor(value / scale);
  const fraction = String(value % scale).padStart(digits, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/** "8.5%" or "₹500". */
export function describeMarkup(kind: MarkupKind, value: number, currency: string): string {
  return kind === "percent" ? `${markupInput(kind, value, currency)}%` : formatMoney({ amount_minor: value, currency });
}
