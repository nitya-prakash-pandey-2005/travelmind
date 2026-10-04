import { expect, test } from "vitest";
import { formatMoney, formatMoneyCompact, formatWholeMoney } from "./money";

test.each([
  [{ amount_minor: 523400, currency: "INR" }, "₹5,234"],
  [{ amount_minor: 12345678, currency: "INR" }, "₹1,23,456.78"],
  [{ amount_minor: 4500, currency: "USD" }, "$45"],
  [{ amount_minor: 4550, currency: "GBP" }, "£45.50"],
  [{ amount_minor: 148, currency: "JPY" }, "¥148"],
])("formats %o as %s", (money, expected) => {
  expect(formatMoney(money)).toBe(expected);
});

// The backend defines the minor unit (offers/money.py); Intl's own digits differ for some currencies
// (PKR, HUF, COP, UGX are 0 in Intl, 2 in the backend), so the scale must follow the backend.
test.each([
  [{ amount_minor: 150050, currency: "PKR" }, "PKR 1,500.50"],
  [{ amount_minor: 150000, currency: "HUF" }, "HUF 1,500"],
  [{ amount_minor: 12345, currency: "KWD" }, "KWD 12.345"],
  [{ amount_minor: 150000, currency: "IDR" }, "IDR 150,000"],
])("scales %o by the backend's minor unit", (money, expected) => {
  expect(formatMoney(money).replace(/\s/g, " ")).toBe(expected);
});

test.each([
  [{ amount_minor: 62_000_000, currency: "INR" }, "₹6.2L"],
  [{ amount_minor: 1_240_000, currency: "INR" }, "₹12.4K"],
  [{ amount_minor: 1_850_000_000, currency: "INR" }, "₹1.9Cr"],
  [{ amount_minor: 1_240_000, currency: "USD" }, "$12.4K"],
  [{ amount_minor: 125_000_000, currency: "GBP" }, "£1.3M"],
  [{ amount_minor: 0, currency: "INR" }, "₹0"],
  [{ amount_minor: 148_000, currency: "JPY" }, "¥148K"],
])("formats %o compactly as %s", (money, expected) => {
  expect(formatMoneyCompact(money)).toBe(expected);
});

test("a non-finite compact amount reads as a dash", () => {
  expect(formatMoneyCompact({ amount_minor: Number.NaN, currency: "INR" })).toBe("—");
});

test.each([
  [21_680_438, "INR", "₹2,16,804"],
  [6_000_049, "INR", "₹60,000"],
  [4550, "GBP", "£46"],
  [148, "JPY", "¥148"],
  [12_345, "KWD", "KWD 12"],
])("formats %d %s in whole units as %s", (minor, currency, expected) => {
  expect(formatWholeMoney(minor, currency).replace(/\s/g, " ")).toBe(expected);
});
