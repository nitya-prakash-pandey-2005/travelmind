import { useQuery } from "@tanstack/react-query";
import type { ClientOut, TripRef } from "../../api/clients";
import { airportSearchQueryOptions } from "../../api/queries";
import type { Airport } from "../../api/types";
import { isoDateFromNow } from "../../lib/dates";
import { formatDate } from "../../lib/format";

export const KIND_LABEL: Record<string, string> = { individual: "Individual", company: "Company" };

export const kindLabel = (kind: string): string => KIND_LABEL[kind] ?? kind;

/** "DEL → GOI". */
export const tripRoute = (trip: TripRef): string => `${trip.origin} → ${trip.destination}`;

const DAY_MS = 86_400_000;
const utcDay = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/** Calendar days from today to a YYYY-MM-DD date (negative when it is past). */
export function daysFromToday(date: string): number {
  return Math.round((utcDay(date) - utcDay(isoDateFromNow(0))) / DAY_MS);
}

/** "20 Nov 2026 · in 18 days", "2 Sep 2026 · 20 days ago", "… · today". */
export function tripWhen(trip: TripRef): string {
  const days = daysFromToday(trip.depart_date);
  const relative =
    days === 0 ? "today" : days > 0 ? `in ${days} day${days === 1 ? "" : "s"}` : `${-days} day${days === -1 ? "" : "s"} ago`;
  return `${formatDate(trip.depart_date)} · ${relative}`;
}

/** "+91 98100 12345" → "tel:+919810012345"; null when there are no digits to dial ("ask reception"). */
export function telHref(phone: string): string | null {
  return /\d/.test(phone) ? `tel:${phone.replace(/[^\d+]/g, "")}` : null;
}

/** "ravi&sons@example.com" → "mailto:ravi%26sons@example.com": escaped so the address can't add headers, `@` kept readable. */
export const mailtoHref = (email: string): string => `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}`;

/** Every tag across the clients with how many carry it, most used first. */
export function tagCounts(clients: readonly Pick<ClientOut, "tags">[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const client of clients) for (const tag of client.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** A code-only airport, shown until the full record arrives. */
export function airportStub(code: string): Airport {
  return { iata_code: code, name: code, city: null, country_code: "", country_name: "", latitude: 0, longitude: 0 };
}

/** The full airport record for an IATA code (via the airport search), or undefined while it loads or if unknown. */
export function useAirport(code: string | null | undefined): Airport | undefined {
  const lookup = useQuery({ ...airportSearchQueryOptions(code ?? ""), enabled: Boolean(code) });
  return code ? lookup.data?.find((airport) => airport.iata_code === code) : undefined;
}

/** "New Delhi · Indira Gandhi International Airport" or the code alone. */
export function airportPlace(airport: Airport | undefined): string | null {
  if (!airport) return null;
  return [airport.city, airport.name].filter(Boolean).join(" · ");
}
