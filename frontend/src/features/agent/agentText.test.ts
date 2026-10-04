import { expect, test } from "vitest";
import { pollInterval, streamBackoff, type AgentRun } from "../../api/agent";
import { HOTEL, planResult } from "../../test/agentFixtures";
import { enquiryPrompt, suggestedPrompts, tripLine, validateAgentSearch } from "./agentText";
import { planDays } from "./PlanCards";

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

test("reconnect delays grow, then hold at the longest", () => {
  expect([0, 1, 2, 3, 4, 5, 9].map(streamBackoff)).toEqual([1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000]);
});

test("a paused run is polled faster while it works than while it waits, and not at all once final", () => {
  const working = { status: "running" } as AgentRun;
  expect(pollInterval(working, null)).toBe(3_000);
  expect(pollInterval({ status: "waiting_for_user" } as AgentRun, null)).toBe(15_000);
  expect(pollInterval({ status: "done" } as AgentRun, null)).toBe(false);
  expect(pollInterval(working, 401)).toBe(false);
  expect(pollInterval(working, 404)).toBe(false);
});

test("the fallback day plan holds only what the results date: no invented stays or labels", () => {
  const hotelCard = { ...HOTEL };
  const { days, built, undated } = planDays(planResult({ hotels: [hotelCard] }));
  expect(built).toBe(false);
  expect(days.map((day) => day.label)).toEqual([
    "Day 1 · Fri 20 Nov",
    "Day 2 · Sat 21 Nov",
    "Day 3 · Sun 22 Nov",
    "Day 4 · Mon 23 Nov",
    "Day 5 · Tue 24 Nov",
  ]);
  expect(days.every((day) => day.title === null)).toBe(true);
  expect(days[0]?.entries).toEqual([{ kind: "flight", text: "DEL 17:20 → DXB 20:39", detail: "6E 1078 · F1" }]);
  expect(days[1]?.entries).toEqual([]);
  expect(days[1]?.weather?.temp_max_c).toBeCloseTo(30.5);
  expect(days[4]?.entries).toEqual([{ kind: "flight", text: "DXB 11:10 → DEL 14:29", detail: "6E 740 · F1" }]);
  // The flight trip block has no stay dates: the hotel is listed, but on no day.
  expect(days.flatMap((day) => day.entries).some((entry) => entry.kind === "hotel")).toBe(false);
  expect(undated).toEqual([{ name: "Creek View Hotel", ref: "H1" }]);
  const text = JSON.stringify(days);
  expect(text).not.toMatch(/Arrive in|Fly home|Free day/);

  const stay = planDays(
    planResult({
      flights: [],
      hotels: [hotelCard],
      trip: { destination: "DXB", destination_city: "Dubai", check_in: "2026-11-20", check_out: "2026-11-22", adults: 2, nights: 2 },
    }),
  );
  expect(stay.undated).toEqual([]);
  expect(stay.days[0]?.entries).toEqual([{ kind: "hotel", text: "Check-in · Creek View Hotel", detail: "H1" }]);
  expect(stay.days[2]?.entries).toEqual([{ kind: "hotel", text: "Check-out · Creek View Hotel", detail: "H1" }]);
});
