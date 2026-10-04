import type { Provenance } from "../api/offers";
import { Badge } from "./Badge";
import { cn } from "./cn";
import { PROVENANCE } from "./provenance";

/** The provenance pill for an offer: LIVE carries a pulsing dot; the label always says what it means. */
export function ProvenanceBadge({ provenance, className }: { provenance: Provenance; className?: string }) {
  const { tone, label } = PROVENANCE[provenance];
  return (
    <Badge tone={tone} className={className}>
      <span aria-hidden="true" className={cn("dot h-1.5! w-1.5!", provenance === "LIVE" && "tm-live")} />
      {label}
    </Badge>
  );
}
