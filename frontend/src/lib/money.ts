import type { Money } from "../api/offers";

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

/** Integer minor units → "₹5,234", "£45.50". Whole amounts drop the decimals. */
export function formatMoney(money: Money): string {
  const digits = exponent(money.currency);
  const scale = 10 ** digits;
  return formatter(money.currency, digits, money.amount_minor % scale === 0).format(money.amount_minor / scale);
}
