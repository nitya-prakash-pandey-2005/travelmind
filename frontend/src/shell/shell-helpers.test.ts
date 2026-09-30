import { expect, test } from "vitest";
import { daysUntil, demoNotice } from "./DemoBanner";
import { isValidTimeZone, zoneAbbreviation } from "./useClock";

const JULY = new Date("2026-07-01T12:00:00Z");

test("zone abbreviations read the way the agency's country writes them", () => {
  expect(zoneAbbreviation(JULY, "Asia/Kolkata", "IN")).toBe("IST");
  expect(zoneAbbreviation(JULY, "Europe/London", "GB")).toBe("BST");
  expect(zoneAbbreviation(JULY, "America/New_York", "US")).toBe("EDT");
  expect(zoneAbbreviation(JULY, "Asia/Dubai", "AE")).toBe("GST");
});

test("a zone without a common abbreviation falls back to its offset", () => {
  expect(zoneAbbreviation(JULY, "Asia/Kathmandu", "US")).toMatch(/^GMT\+5:45$/);
});

test("unknown timezones are rejected", () => {
  expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
  expect(isValidTimeZone("Mars/Olympus")).toBe(false);
});

test("the demo notice counts whole days left, rounding up", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  expect(daysUntil("2026-10-07T11:00:00Z", now)).toBe(7);
  expect(daysUntil("2026-10-01T13:00:00Z", now)).toBe(2);
  expect(daysUntil("2026-09-30T13:00:00Z", now)).toBe(1);
  expect(daysUntil("2026-09-29T13:00:00Z", now)).toBe(0);
  expect(daysUntil(null, now)).toBeNull();
  expect(demoNotice(1)).toBe("You're exploring a demo workspace with sample data. It resets in 1 day.");
  expect(demoNotice(0)).toBe("You're exploring a demo workspace with sample data. It resets today.");
  expect(demoNotice(null)).toBe("You're exploring a demo workspace with sample data.");
});
