import { useQuery } from "@tanstack/react-query";
import { ServerCog } from "lucide-react";
import { useState } from "react";
import { supplierHealthQueryOptions, type SupplierHealth, type SupplierHealthRange } from "../../api/dashboard";
import { formatNumber } from "../../lib/format";
import { Badge } from "../../ui/Badge";
import { percent } from "../../ui/charts/shared";
import { DataTable, type DataTableColumn } from "../../ui/DataTable";
import { EmptyState } from "../../ui/EmptyState";
import { Panel } from "../../ui/Panel";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { StatusDot, type Status } from "../../ui/StatusDot";
import { cn } from "../../ui/cn";
import { ErrorPanel } from "./PanelError";
import { FooterLink, LoadingPanel } from "./panelParts";

const TITLE = "Supplier health";
const RANGES = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
] as const;
const RANGE_WORDS: Record<SupplierHealthRange, string> = { "24h": "last 24 hours", "7d": "last 7 days" };

const PERCENT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const OFFERS = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/** Healthy from 95 % success, degraded from 80 %, failing below; no status without calls. */
function healthOf(row: SupplierHealth): { status: Status; word: string } {
  if (row.calls === 0) return { status: "unknown", word: "No calls" };
  if (row.success_pct >= 95) return { status: "ok", word: "Healthy" };
  if (row.success_pct >= 80) return { status: "degraded", word: "Degraded" };
  return { status: "down", word: "Failing" };
}

const SUCCESS_TONE: Record<Status, string> = {
  ok: "text-ink",
  degraded: "text-warn",
  down: "text-danger",
  unknown: "text-dim",
};

const ms = (value: number) => `${formatNumber(Math.round(value))} ms`;

/**
 * p50 and p95 on one track shared by every supplier: the solid bar reaches p50 (half of calls answered),
 * the light extension p95. The figures sit beside it, so the bar is never the only way to read them.
 */
function LatencyBar({ row, scaleMs }: { row: SupplierHealth; scaleMs: number }) {
  if (row.p50_ms === null || row.p95_ms === null) {
    return <span className="text-[11px] text-faint">No successful calls</span>;
  }
  const name = `${row.supplier} ${row.kind} latency`;
  return (
    <span role="img" aria-label={`${name}: p50 ${ms(row.p50_ms)}, p95 ${ms(row.p95_ms)}`} className="flex min-w-[9rem] items-center gap-2">
      <span aria-hidden="true" className="relative block h-1.5 flex-1 overflow-hidden rounded-[2px] bg-chart-grid">
        <span className="absolute inset-y-0 left-0 rounded-r-[2px] bg-chart-1/30" style={{ width: percent(row.p95_ms, scaleMs) }} />
        <span className="absolute inset-y-0 left-0 rounded-r-[2px] bg-chart-1" style={{ width: percent(row.p50_ms, scaleMs) }} />
      </span>
      <span aria-hidden="true" className="whitespace-nowrap font-mono text-[11px] tabular-nums text-dim">
        <span className="text-ink">{formatNumber(Math.round(row.p50_ms))}</span> / {formatNumber(Math.round(row.p95_ms))} ms
      </span>
    </span>
  );
}

export function SupplierHealthPanel({ className }: { className?: string }) {
  const [range, setRange] = useState<SupplierHealthRange>("24h");
  const health = useQuery(supplierHealthQueryOptions(range));
  const rangeSwitch = <SegmentedControl label="Supplier range" options={RANGES} value={range} onChange={setRange} />;
  const description = `Call success, latency and offers per search, ${RANGE_WORDS[range]}`;

  // The range switch stays in every state, so a failing range can be switched away from.
  if (health.isPending) {
    return <LoadingPanel title={TITLE} description={description} actions={rangeSwitch} rows={3} className={className} />;
  }
  if (health.isError && !health.data) {
    return (
      <ErrorPanel
        title={TITLE}
        description={description}
        error={health.error}
        onRetry={() => void health.refetch()}
        retrying={health.isFetching}
        className={className}
        actions={rangeSwitch}
      />
    );
  }

  const suppliers = health.data.suppliers;
  // One latency scale for every supplier, so the bars compare at a glance.
  const scaleMs = Math.max(0, ...suppliers.map((s) => s.p95_ms ?? 0));

  const columns: DataTableColumn<SupplierHealth>[] = [
    {
      key: "supplier",
      header: "Supplier",
      className: "pl-4",
      sortValue: (row) => row.supplier,
      cell: (row) => {
        const status = healthOf(row);
        return (
          <span className="flex flex-col">
            <span className="flex items-center gap-2 whitespace-nowrap">
              <StatusDot status={status.status} label={row.supplier} className="font-mono text-ink" />
              <Badge>{row.kind}</Badge>
            </span>
            <span className="pl-3.5 text-[11px] leading-4 text-faint">{status.word}</span>
          </span>
        );
      },
    },
    {
      key: "success",
      header: "Success",
      align: "right",
      sortValue: (row) => row.success_pct,
      cell: (row) => (
        <span className="flex flex-col items-end">
          <span className={SUCCESS_TONE[healthOf(row).status]}>
            {row.calls > 0 && Number.isFinite(row.success_pct) ? `${PERCENT.format(row.success_pct)}%` : "—"}
          </span>
          <span className="whitespace-nowrap font-sans text-[11px] leading-4 text-faint">
            {formatNumber(row.ok)} of {formatNumber(row.calls)} calls
          </span>
        </span>
      ),
    },
    {
      key: "latency",
      header: "Latency p50 / p95",
      className: "w-[40%]",
      sortValue: (row) => row.p50_ms ?? Number.MAX_SAFE_INTEGER,
      cell: (row) => <LatencyBar row={row} scaleMs={scaleMs} />,
    },
    {
      key: "offers",
      header: "Offers",
      align: "right",
      className: "pr-4",
      sortValue: (row) => row.avg_offers ?? -1,
      cell: (row) => (row.avg_offers !== null && Number.isFinite(row.avg_offers) ? OFFERS.format(row.avg_offers) : "—"),
    },
  ];

  return (
    <Panel
      title={TITLE}
      description={description}
      actions={rangeSwitch}
      busy={health.isPlaceholderData}
      flush
      className={cn("flex flex-col", className)}
      footer={suppliers.length > 0 && <FooterLink to="/app/suppliers">View all suppliers</FooterLink>}
    >
      <DataTable
        caption="Suppliers"
        columns={columns}
        rows={suppliers}
        getRowId={(row) => `${row.supplier}-${row.kind}`}
        className="border-t border-line"
        emptyState={
          <EmptyState
            icon={ServerCog}
            title="No supplier calls yet"
            description="Every fare and hotel search is timed here, supplier by supplier."
            action={{ label: "Open suppliers", to: "/app/suppliers" }}
          />
        }
      />
    </Panel>
  );
}
