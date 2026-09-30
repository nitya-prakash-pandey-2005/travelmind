import type { Provenance } from "../api/offers";

export type ProvenanceTone = "ok" | "info" | "warn";

/**
 * How every offer (flight or hotel) labels where its price came from: live supplier inventory (green),
 * a cached indicative price (blue), or sandbox test inventory that can't be booked (amber).
 */
export const PROVENANCE: Record<Provenance, { tone: ProvenanceTone; label: string }> = {
  LIVE: { tone: "ok", label: "Live" },
  CACHED: { tone: "info", label: "Cached · indicative" },
  SANDBOX: { tone: "warn", label: "Sandbox · not bookable" },
};
