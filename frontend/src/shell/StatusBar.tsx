import { useQuery } from "@tanstack/react-query";
import { PlugZap } from "lucide-react";
import { healthQueryOptions, suppliersQueryOptions } from "../api/queries";
import type { Me } from "../api/types";
import { StatusDot, type Status } from "../ui/StatusDot";
import { formatClock, isValidTimeZone, useClock, zoneAbbreviation } from "./useClock";

const LABELS: Record<Status, string> = {
  ok: "API online",
  degraded: "API degraded",
  down: "API offline",
  unknown: "API checking…",
};

/** Inventory suppliers (flights, hotels) count as connections; enrichment sources (CO₂, FX) don't. */
const INVENTORY_KINDS = new Set(["flights", "hotels"]);

function SuppliersConnected() {
  const { data } = useQuery(suppliersQueryOptions);
  if (!data) return null;
  const count = data.filter((supplier) => supplier.connected && INVENTORY_KINDS.has(supplier.kind)).length;
  return (
    <span className="hidden items-center gap-1.5 md:inline-flex">
      <PlugZap size={12} aria-hidden="true" className={count > 0 ? "text-ok" : "text-dim"} />
      <span>{`${count} ${count === 1 ? "supplier" : "suppliers"} connected`}</span>
    </span>
  );
}

export function StatusBar({ me }: { me: Me }) {
  const { data } = useQuery(healthQueryOptions);
  const status: Status = data ?? "unknown";
  const now = useClock();
  const { timezone, country_code } = me.agency;
  const agencyZone = timezone !== "UTC" && isValidTimeZone(timezone) ? timezone : null;
  return (
    <footer className="flex h-8 shrink-0 items-center justify-between gap-4 overflow-hidden border-t border-line bg-glass px-3 font-mono text-[11px] uppercase tracking-[0.16em] text-dim backdrop-blur-xl lg:px-4">
      <div className="flex min-w-0 items-center gap-5">
        <StatusDot status={status} label={LABELS[status]} />
        <SuppliersConnected />
      </div>
      <div className="flex shrink-0 gap-4 tabular-nums">
        <span className={agencyZone ? "max-sm:hidden" : undefined}>UTC {formatClock(now, "UTC")}</span>
        {agencyZone && (
          <span className="text-ink">
            {zoneAbbreviation(now, agencyZone, country_code)} {formatClock(now, agencyZone)}
          </span>
        )}
      </div>
    </footer>
  );
}
