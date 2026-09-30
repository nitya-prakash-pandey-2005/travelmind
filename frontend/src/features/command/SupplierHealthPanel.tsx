import { useQuery } from "@tanstack/react-query";
import { ServerCog } from "lucide-react";
import { useState } from "react";
import { supplierHealthQueryOptions, type SupplierHealth, type SupplierHealthRange } from "../../api/dashboard";
import { formatNumber } from "../../lib/format";
import { Badge } from "../../ui/Badge";
import { LatencyBand } from "../../ui/charts";
import { EmptyState } from "../../ui/EmptyState";
import { Panel } from "../../ui/Panel";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { PanelSkeleton } from "../../ui/Skeleton";
import { StatusDot, type Status } from "../../ui/StatusDot";
import { ErrorPanel } from "./PanelError";

const TITLE = "Supplier health";
const EYEBROW = "Success · latency · offers";
const RANGES = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
] as const;

const PERCENT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const OFFERS = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/** Healthy from 95 % success, degraded from 80 %, down below; unknown without calls. */
function healthOf(row: SupplierHealth): { status: Status; word: string } {
  if (row.calls === 0) return { status: "unknown", word: "no calls" };
  if (row.success_pct >= 95) return { status: "ok", word: "healthy" };
  if (row.success_pct >= 80) return { status: "degraded", word: "degraded" };
  return { status: "down", word: "failing" };
}

function SupplierRow({ row, scaleMs }: { row: SupplierHealth; scaleMs: number }) {
  const health = healthOf(row);
  const name = `${row.supplier} ${row.kind}`;
  return (
    <li className="flex flex-col gap-2 border-b border-line/60 py-3 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 font-mono text-sm text-ink">
          <StatusDot status={health.status} label={row.supplier} />
          <span className="sr-only">({health.word})</span>
          <Badge>{row.kind}</Badge>
        </div>
        <span className="font-mono text-sm tabular-nums text-ink">{`${PERCENT.format(row.success_pct)}%`}</span>
      </div>
      {row.p50_ms !== null && row.p95_ms !== null ? (
        <LatencyBand p50={row.p50_ms} p95={row.p95_ms} max={scaleMs} label={`${name} latency`} />
      ) : (
        <p className="font-mono text-[11px] text-dim">No successful calls</p>
      )}
      <p className="font-mono text-[11px] tabular-nums text-dim">
        {formatNumber(row.ok)} of {formatNumber(row.calls)} calls ok
        {row.avg_offers !== null && ` · ${OFFERS.format(row.avg_offers)} offers avg`}
      </p>
    </li>
  );
}

export function SupplierHealthPanel({ className }: { className?: string }) {
  const [range, setRange] = useState<SupplierHealthRange>("24h");
  const health = useQuery(supplierHealthQueryOptions(range));
  const rangeSwitch = <SegmentedControl label="Supplier range" options={RANGES} value={range} onChange={setRange} />;

  if (health.isPending) return <PanelSkeleton title={TITLE} eyebrow={EYEBROW} className={className} />;
  if (health.isError && !health.data) {
    return (
      <ErrorPanel
        title={TITLE}
        eyebrow={EYEBROW}
        error={health.error}
        onRetry={() => void health.refetch()}
        retrying={health.isFetching}
        className={className}
      />
    );
  }

  const suppliers = health.data.suppliers;
  // One latency scale for every supplier, so the bands compare at a glance.
  const scaleMs = Math.max(0, ...suppliers.map((s) => s.p95_ms ?? 0));

  return (
    <Panel
      variant="glass"
      title={TITLE}
      eyebrow={EYEBROW}
      actions={rangeSwitch}
      busy={health.isPlaceholderData}
      className={className}
    >
      {suppliers.length === 0 ? (
        <EmptyState
          icon={ServerCog}
          title="No supplier calls yet."
          description="Every fare and hotel scan is timed here, supplier by supplier."
          action={{ label: "Open suppliers", to: "/app/suppliers" }}
        />
      ) : (
        <ul aria-label="Suppliers">
          {suppliers.map((row) => (
            <SupplierRow key={`${row.supplier}-${row.kind}`} row={row} scaleMs={scaleMs} />
          ))}
        </ul>
      )}
    </Panel>
  );
}
