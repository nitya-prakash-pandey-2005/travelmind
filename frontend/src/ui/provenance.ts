import type { Provenance } from "../api/offers";

/** How every offer (flight or hotel) labels where its price came from. */
export const PROVENANCE: Record<Provenance, { tone: "ok" | "warn" | "ai"; label: string }> = {
  LIVE: { tone: "ok", label: "Live" },
  CACHED: { tone: "warn", label: "Cached · indicative" },
  SANDBOX: { tone: "ai", label: "Sandbox · not bookable" },
};
