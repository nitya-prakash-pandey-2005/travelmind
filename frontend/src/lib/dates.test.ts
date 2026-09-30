import { expect, test } from "vitest";
import { dayShift, isoDateFromNow, localTime } from "./dates";

test("dates are local calendar days", () => {
  const now = new Date(2026, 11, 30, 23, 30); // 30 Dec 2026, 23:30 local
  expect(isoDateFromNow(0, now)).toBe("2026-12-30");
  expect(isoDateFromNow(3, now)).toBe("2027-01-02");
});

test("supplier times are shown as given, in airport-local time", () => {
  expect(localTime("2026-11-20T06:10:00")).toBe("06:10");
  expect(dayShift("2026-11-20T23:10:00", "2026-11-21T01:20:00")).toBe(1);
  expect(dayShift("2026-11-20T06:10:00", "2026-11-20T08:20:00")).toBe(0);
});
