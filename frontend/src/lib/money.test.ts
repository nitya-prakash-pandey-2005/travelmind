import { expect, test } from "vitest";
import { formatMoney } from "./money";

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
