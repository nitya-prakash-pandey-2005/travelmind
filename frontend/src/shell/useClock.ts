import { useEffect, useState } from "react";

export function useClock(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function formatClock(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

/**
 * Short name of a timezone as people in the agency's country write it ("IST" for Asia/Kolkata in India,
 * "BST"/"GMT" for London), falling back to the en-US name, which may be an offset like "GMT+4".
 */
export function zoneAbbreviation(date: Date, timeZone: string, countryCode: string): string {
  for (const locale of [`en-${countryCode}`, "en-US"]) {
    try {
      const name = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" })
        .formatToParts(date)
        .find((part) => part.type === "timeZoneName")?.value;
      if (name && !/^GMT[+-]/.test(name)) return name;
      if (name && locale === "en-US") return name;
    } catch {
      // Unknown locale or zone: try the next locale.
    }
  }
  return timeZone;
}

/** True when the value is a timezone this browser can format. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return true;
  } catch {
    return false;
  }
}
