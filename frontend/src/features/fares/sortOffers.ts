import type { FlightOffer } from "../../api/offers";

export type SortMode = "price" | "duration" | "co2";

/** The server ranks by display price; the other modes re-sort, with unknown values last (stable). */
export function sortOffers(offers: FlightOffer[], mode: SortMode): FlightOffer[] {
  if (mode === "price") return offers;
  const value = (offer: FlightOffer) =>
    (mode === "duration" ? offer.total_duration_minutes : offer.co2_kg_per_passenger) ?? Number.POSITIVE_INFINITY;
  return [...offers].sort((a, b) => {
    const diff = value(a) - value(b);
    return Number.isNaN(diff) ? 0 : diff;
  });
}
