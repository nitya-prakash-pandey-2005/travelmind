import type { Cabin } from "../../api/offers";
import type { PublicBaggage, PublicOption, PublicSlice } from "../../api/publicQuotes";
import { formatNumber } from "../../lib/format";

/** Wording for the client's page: plain, and never the agency's internal terms. */

export const CABIN_LABEL: Record<Cabin, string> = {
  economy: "Economy",
  premium_economy: "Premium economy",
  business: "Business",
  first: "First",
};

const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const dateFormats = new Map<string, Intl.DateTimeFormat>();

/** The date format for `timeZone`, falling back to UTC for a zone this browser doesn't know. */
function dateFormat(timeZone: string): Intl.DateTimeFormat {
  let format = dateFormats.get(timeZone);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric", timeZone });
    } catch {
      format = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    }
    dateFormats.set(timeZone, format);
  }
  return format;
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? "";
}

/** Airport-local "2026-11-20T06:10:00" read as written, so times at one airport can be compared. */
export function asUtc(iso: string): number {
  return Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
    Number(iso.slice(11, 13)),
    Number(iso.slice(14, 16)),
  );
}

/** "Fri 20 Nov" for an airport-local timestamp. */
export function travelDay(iso: string): string {
  const parts = DAY.formatToParts(new Date(asUtc(iso)));
  return `${part(parts, "weekday")} ${part(parts, "day")} ${part(parts, "month")}`;
}

/** "14 Oct 2026" for an instant, as the date in `timeZone` (the agency's; "—" if unreadable). */
export function longDate(iso: string, timeZone = "UTC"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = dateFormat(timeZone).formatToParts(date);
  return `${part(parts, "day")} ${part(parts, "month")} ${part(parts, "year")}`;
}

/** "Outbound" and "Return" for a round trip; numbered flights for anything longer. */
export function journeyLabel(index: number, count: number): string {
  if (count === 1) return "Flight";
  if (count === 2) return index === 0 ? "Outbound" : "Return";
  return `Flight ${index + 1}`;
}

export function stopsLabel(slice: PublicSlice): string {
  const vias = slice.segments.slice(0, -1).map((s) => s.destination);
  const count = Math.max(slice.stops, vias.length);
  if (count === 0) return "Nonstop";
  const where = vias.length > 0 ? ` · ${vias.join(", ")}` : "";
  return `${count} stop${count > 1 ? "s" : ""}${where}`;
}

/** "DEL → DXB → DEL" across the whole trip. */
export function routeLabel(option: PublicOption): string {
  const points: string[] = [];
  for (const slice of option.slices) {
    if (points[points.length - 1] !== slice.origin) points.push(slice.origin);
    points.push(slice.destination);
  }
  return points.join(" → ");
}

export function carrierName(option: PublicOption): string {
  return option.carrier_name ?? option.carrier_code;
}

export function baggageLabel({ checked, carry_on: cabin }: PublicBaggage): string {
  const parts: string[] = [];
  if (checked !== null) parts.push(checked === 0 ? "No checked bag" : `${checked} checked bag${checked > 1 ? "s" : ""}`);
  if (cabin !== null) parts.push(cabin === 0 ? "No cabin bag" : `${cabin} cabin bag${cabin > 1 ? "s" : ""}`);
  return parts.length > 0 ? parts.join(" · ") : "Baggage on request";
}

export function refundLabel(refundable: boolean | null): string {
  if (refundable === null) return "Refund terms on request";
  return refundable ? "Refundable" : "Non-refundable";
}

export function changeLabel(changeable: boolean | null): string {
  if (changeable === null) return "Change terms on request";
  return changeable ? "Changes allowed" : "No changes";
}

export function co2Label(kg: number): string {
  return `${formatNumber(kg)} kg CO₂ per passenger`;
}

/** Up to two initials for the agency mark: "Orbit Travel Co." → "OT". */
export function initials(name: string): string {
  const words = name
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}
