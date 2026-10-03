import { expect, test } from "vitest";
import { describeMarkup, markupInput, parseMarkup } from "./markup";

test("percent markups are typed as a percentage and sent in basis points", () => {
  expect(parseMarkup("percent", "8.5", "INR")).toEqual({ value: 850 });
  expect(parseMarkup("percent", "12", "INR")).toEqual({ value: 1200 });
  expect(parseMarkup("percent", "0.25", "INR")).toEqual({ value: 25 });
  expect(parseMarkup("percent", "100", "INR")).toEqual({ value: 10_000 });
  expect(parseMarkup("percent", "", "INR")).toEqual({ value: null });
  expect(parseMarkup("percent", "100.5", "INR")).toEqual({ error: "Up to 100%." });
  expect(parseMarkup("percent", "8.555", "INR")).toEqual({ error: "Up to 2 decimal places." });
  expect(parseMarkup("percent", "-1", "INR")).toEqual({ error: "Enter a number, like 8.5." });
  expect(parseMarkup("percent", "abc", "INR")).toEqual({ error: "Enter a number, like 8.5." });
});

test("fixed markups are typed in major units and sent in minor units of the quote currency", () => {
  expect(parseMarkup("fixed", "500", "INR")).toEqual({ value: 50_000 });
  expect(parseMarkup("fixed", "250.50", "INR")).toEqual({ value: 25_050 });
  expect(parseMarkup("fixed", "1,250", "INR")).toEqual({ value: 125_000 });
  expect(parseMarkup("fixed", "1,250.50", "INR")).toEqual({ value: 125_050 });
  expect(parseMarkup("percent", "8,5", "INR")).toEqual({ error: "Use a dot for decimals, like 8.5." });
  expect(parseMarkup("fixed", "12,50", "INR")).toEqual({ error: "Use a dot for decimals, like 8.5." });
  expect(parseMarkup("fixed", "1,25,000", "INR")).toEqual({ value: 12_500_000 });
  expect(parseMarkup("fixed", "1,2,3", "INR")).toEqual({ error: "Use a dot for decimals, like 8.5." });
  expect(parseMarkup("fixed", "1.005", "INR")).toEqual({ error: "Up to 2 decimal places." });
  expect(parseMarkup("fixed", "3000", "JPY")).toEqual({ value: 3000 });
  expect(parseMarkup("fixed", "3000.5", "JPY")).toEqual({ error: "Whole amounts only." });
  expect(parseMarkup("fixed", "1.125", "KWD")).toEqual({ value: 1125 });
  expect(parseMarkup("fixed", "20000000", "INR")).toEqual({ error: "Up to ₹1,00,00,000." });
});

test("stored values read back as the text an agent would type", () => {
  expect(markupInput("percent", 850, "INR")).toBe("8.5");
  expect(markupInput("percent", 1000, "INR")).toBe("10");
  expect(markupInput("fixed", 25_050, "INR")).toBe("250.5");
  expect(markupInput("fixed", 50_000, "INR")).toBe("500");
  expect(describeMarkup("percent", 850, "INR")).toBe("8.5%");
  expect(describeMarkup("fixed", 50_000, "INR")).toBe("₹500");
});
