import { expect, test } from "vitest";
import { enquiryPrompt, suggestedPrompts, tripLine, validateAgentSearch } from "./agentText";

test("an enquiry becomes a request with only the parts it has", () => {
  const base = { origin: "DEL", destination: "DXB", depart_date: "2026-11-20", return_date: "2026-11-24", adults: 2, children_ages: [], cabin: "economy" as const };
  expect(enquiryPrompt(base)).toBe("Plan a trip from DEL to DXB, 20 Nov 2026 to 24 Nov 2026, for 2 adults, economy.");
  expect(enquiryPrompt({ ...base, return_date: null, cabin: "premium_economy" })).toBe(
    "Plan a trip from DEL to DXB, departing 20 Nov 2026, one way, for 2 adults, premium economy.",
  );
  expect(enquiryPrompt({ ...base, origin: null, depart_date: null, return_date: null, adults: 1, children_ages: [4, 9] })).toBe(
    "Plan a trip to DXB, for 1 adult and 2 children (ages 4, 9), economy.",
  );
});

test("the address prompt is trimmed, capped at 2,000 characters, and dropped when empty or not text", () => {
  expect(validateAgentSearch({ prompt: "  Goa  " })).toEqual({ prompt: "Goa" });
  expect(validateAgentSearch({ prompt: "x".repeat(2500) }).prompt).toHaveLength(2000);
  expect(validateAgentSearch({ prompt: "   " })).toEqual({ prompt: undefined });
  expect(validateAgentSearch({ prompt: 42 })).toEqual({ prompt: undefined });
});

test("suggested requests use the agency's routes, else busy routes, always dated a month ahead", () => {
  const now = new Date("2026-10-04T08:00:00Z");
  const own = suggestedPrompts([{ origin: "BOM", destination: "GOI" }], now);
  expect(own).toEqual([{ label: "BOM → GOI", prompt: "Mumbai to Goa for 2 adults, 3 Nov to 7 Nov, economy" }]);
  const defaults = suggestedPrompts([], now);
  expect(defaults).toHaveLength(4);
  expect(defaults[0]?.prompt).toBe("Delhi to Dubai for 2 adults, 3 Nov to 7 Nov, economy");
});

test("a trip reads as one line for a follow-up request", () => {
  expect(tripLine({ origin: "DEL", destination: "DXB", depart_date: "2026-11-20", return_date: "2026-11-24", adults: 2, children_ages: [], cabin: "business" })).toBe(
    "DEL to DXB, 20 Nov 2026 to 24 Nov 2026, 2 adults, business class",
  );
  expect(tripLine({ destination: "GOI", check_in: "2026-12-12", check_out: "2026-12-16", adults: 4 })).toBe(
    "a stay near GOI, 12 Dec 2026 to 16 Dec 2026, 4 adults",
  );
});
