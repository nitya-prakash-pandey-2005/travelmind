import { queryOptions, useQuery } from "@tanstack/react-query";
import { checkHealth, type ApiHealth } from "../api/health";
import { qk, suppliersQueryOptions } from "../api/queries";
import type { Me } from "../api/types";
import { formatNumber } from "../lib/format";
import { cn } from "../ui/cn";
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

type ApiTelemetry = { status: ApiHealth; latencyMs: number };

/** The API health check, timed: status plus round-trip latency, refreshed every 30 s. */
const apiTelemetryQueryOptions = queryOptions({
  queryKey: [...qk.health, "telemetry"] as const,
  queryFn: async ({ signal }): Promise<ApiTelemetry> => {
    const started = performance.now();
    const status = await checkHealth(signal);
    return { status, latencyMs: Math.max(0, Math.round(performance.now() - started)) };
  },
  refetchInterval: 30_000,
  retry: false,
});

function Divider({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("h-3 w-px shrink-0 bg-line", className)} />;
}

function SuppliersConnected() {
  const { data } = useQuery(suppliersQueryOptions);
  if (!data) return null;
  const count = data.filter((supplier) => supplier.connected && INVENTORY_KINDS.has(supplier.kind)).length;
  return (
    <>
      <Divider className="max-md:hidden" />
      <span className="hidden items-center gap-1.5 md:inline-flex">
        <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", count > 0 ? "bg-ok" : "bg-faint")} />
        <span>{`${count} ${count === 1 ? "supplier" : "suppliers"} connected`}</span>
      </span>
    </>
  );
}

/** Telemetry strip along the bottom of the app: API status and latency, suppliers, UTC and agency time. */
export function StatusBar({ me }: { me: Me }) {
  const { data } = useQuery(apiTelemetryQueryOptions);
  const status: Status = data?.status ?? "unknown";
  const now = useClock();
  const { timezone, country_code } = me.agency;
  const agencyZone = timezone !== "UTC" && isValidTimeZone(timezone) ? timezone : null;
  return (
    <footer className="relative flex h-8 shrink-0 items-center justify-between gap-4 overflow-hidden border-t border-line bg-chrome px-(--gutter) font-mono text-[11px] leading-4 tracking-[0.04em] text-dim backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-3">
        <StatusDot status={status} label={LABELS[status]} />
        {data && data.status !== "down" && (
          <span className="tabular-nums max-sm:hidden" title="Round trip to the TravelMind API">
            {`${formatNumber(data.latencyMs)} ms`}
          </span>
        )}
        <SuppliersConnected />
      </div>
      <div className="flex shrink-0 items-center gap-3 tabular-nums">
        <span className={agencyZone ? "max-sm:hidden" : undefined}>UTC {formatClock(now, "UTC")}</span>
        {agencyZone && (
          <>
            <Divider className="max-sm:hidden" />
            <span className="text-ink">
              {zoneAbbreviation(now, agencyZone, country_code)} {formatClock(now, agencyZone)}
            </span>
          </>
        )}
      </div>
    </footer>
  );
}
