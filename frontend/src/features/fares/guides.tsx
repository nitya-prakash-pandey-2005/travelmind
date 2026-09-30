import { Badge } from "../../ui/Badge";
import { ProvenanceBadge } from "../../ui/ProvenanceBadge";
import type { GuideSection } from "./ReadingGuide";

/** The provenance pills shared by flight and hotel results. */
export const PROVENANCE_SECTION: GuideSection = {
  title: "Where the price comes from",
  entries: [
    { term: <ProvenanceBadge provenance="LIVE" />, text: "Priced by a connected supplier for this search." },
    { term: <ProvenanceBadge provenance="CACHED" />, text: "A recent market price, not a live quote. Check it before quoting." },
    { term: <ProvenanceBadge provenance="SANDBOX" />, text: "Test inventory for demos and development. It can't be booked." },
  ],
};

/** A plain-text label from a result card, shown as a small chip. */
export const TERM = "rounded-[4px] border border-line bg-surface-2 px-1.5 py-px font-mono text-[11px] text-ink";

/** What each label on a fare means, matching the offer cards and fare insight word for word. */
export const FARE_GUIDE: GuideSection[] = [
  PROVENANCE_SECTION,
  {
    title: "Fare insight",
    entries: [
      { term: <Badge tone="ok">Good price</Badge>, text: "Below the 25th percentile of per-traveller fares seen on this route." },
      { term: <Badge tone="neutral">Typical price</Badge>, text: "Between the 25th and 75th percentiles." },
      { term: <Badge tone="warn">High price</Badge>, text: "Above the 75th percentile. No label means there isn't enough history yet." },
    ],
  },
  {
    title: "CO₂ per passenger",
    entries: [
      { term: <span className={TERM}>this flight</span>, text: "Google Travel Impact Model estimate for the exact flights." },
      { term: <span className={TERM}>route typical</span>, text: "Google's typical figure for the route, when the flight isn't modelled." },
      { term: <span className={TERM}>supplier est.</span>, text: "The supplier's own estimate. No figure means no source had one." },
    ],
  },
];

export const FARE_NOTE =
  "Verify price re-checks an offer with its supplier before you quote it. ≈ marks a price converted with ECB reference rates; billing is in the supplier's currency.";
