import type { Money } from "../api/offers";

/*
 * Which format where:
 * - formatMoneyCompact ("₹31.1L"): KPI tiles and Command Center dashboard figures.
 * - formatWholeMoney ("₹2,16,804"): tables, cards, facts and budgets.
 * - formatMoney (exact minor units, "₹2,16,804.38"): only where the client is quoted a price: the quote's
 *   price breakdowns (and the supplier fares they are built from), the send dialog and WhatsApp text, and
 *   the public quote page.
 */

/**
 * ISO 4217 currencies whose minor unit isn't 1/100: the same table the backend uses to define
 * `amount_minor` (backend/src/travelmind/offers/money.py). Intl's own digits differ for some
 * currencies (PKR, HUF, COP, UGX), so the backend's table sets the scale.
 */
const EXPONENTS: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  IDR: 0,
  CLP: 0,
  ISK: 0,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  JOD: 3,
  TND: 3,
};

const cache = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, fractionDigits: number, whole: boolean): Intl.NumberFormat {
  const key = `${currency}:${whole}`;
  let format = cache.get(key);
  if (!format) {
    format = new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: whole ? 0 : fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    cache.set(key, format);
  }
  return format;
}

function exponent(currency: string): number {
  return EXPONENTS[currency.toUpperCase()] ?? 2;
}

/** Digits after the decimal point in `currency`'s minor unit (2 for INR, 0 for JPY, 3 for KWD). */
export function currencyExponent(currency: string): number {
  return exponent(currency);
}

/** Integer minor units → "₹5,234", "£45.50". Whole amounts drop the decimals. */
export function formatMoney(money: Money): string {
  const digits = exponent(money.currency);
  const scale = 10 ** digits;
  return formatter(money.currency, digits, money.amount_minor % scale === 0).format(money.amount_minor / scale);
}

/** Whole units, rounded half-up from minor units: "₹2,16,804" rather than "₹2,16,804.38". */
export function formatWholeMoney(minor: number, currency: string): string {
  const scale = 10 ** exponent(currency);
  return formatMoney({ amount_minor: Math.round(minor / scale) * scale, currency });
}

const compactCache = new Map<string, Intl.NumberFormat>();

/**
 * Integer minor units → a short headline amount: "₹6.2L", "₹1.9Cr" (Indian grouping for INR),
 * "$12.4K", "£1.3M". "—" for an amount that isn't a finite number.
 */
export function formatMoneyCompact(money: Money): string {
  if (!Number.isFinite(money.amount_minor)) return "—";
  const currency = money.currency.toUpperCase();
  let format = compactCache.get(currency);
  if (!format) {
    format = new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    });
    compactCache.set(currency, format);
  }
  return format.format(money.amount_minor / 10 ** exponent(currency));
}
