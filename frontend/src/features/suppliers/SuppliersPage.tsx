import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, CircleAlert, PlugZap } from "lucide-react";
import { asApiError } from "../../api/client";
import { supplierHealthQueryOptions, type SupplierHealth } from "../../api/dashboard";
import type { SupplierStatus } from "../../api/offers";
import { suppliersQueryOptions } from "../../api/queries";
import { formatNumber } from "../../lib/format";
import { Badge } from "../../ui/Badge";
import { KpiStrip, KpiTile } from "../../ui/charts";
import { DataTable, type DataTableColumn } from "../../ui/DataTable";
import { EmptyState } from "../../ui/EmptyState";
import { PageHeader } from "../../ui/PageHeader";
import { Panel } from "../../ui/Panel";
import { Skeleton } from "../../ui/Skeleton";
import { StatusDot } from "../../ui/StatusDot";
import { KIND, MODE, callsLine, healthOf, isBooking, latencyLine, ms } from "./supplierMeta";

/**
 * Setup facts the status endpoint doesn't carry: the server setting for built-in sources (keyed ones name
 * their variable in `detail`) and each provider's developer docs.
 */
const SETUP: Record<string, { setting?: string; note?: string; docs?: string }> = {
  duffel: { docs: "https://duffel.com/docs" },
  sandbox: { setting: "TM_SANDBOX_SUPPLIER", note: "On by default outside production" },
  liteapi: { docs: "https://docs.liteapi.travel" },
  google_tim: { docs: "https://developers.google.com/travel/impact-model" },
  travelpayouts: { docs: "https://support.travelpayouts.com/hc/en-us/articles/203956163" },
  ecb: {
    setting: "TM_FX_ENABLED",
    note: "On by default",
    docs: "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html",
  },
};

/** Where each data service shows up in the product. */
const USED_FOR: Partial<Record<SupplierStatus["kind"], string>> = {
  emissions: "CO₂ per passenger on fare results",
  price_history: "Fare insight: how a fare compares with the route's history",
  exchange_rates: "≈ prices converted into your agency's currency",
};

/** Splits "Hotel rates worldwide. Set TM_LITEAPI_KEY." into what it provides and the variable to set. */
function splitDetail(detail: string): { about: string; variable: string | null } {
  const match = /^(.*?)\s*Set (TM_[A-Z0-9_]+)\.\s*$/.exec(detail);
  return match ? { about: match[1] ?? "", variable: match[2] ?? null } : { about: detail, variable: null };
}

const CODE = "break-all rounded-[4px] border border-line bg-surface-2 px-1 py-px font-mono text-xs text-ink";

function Setup({ supplier }: { supplier: SupplierStatus }) {
  const { variable } = splitDetail(supplier.detail);
  const extra = SETUP[supplier.code];
  return (
    <span className="flex flex-col items-start gap-1">
      {variable ? (
        <span className="text-dim">
          Set <code className={CODE}>{variable}</code>.
        </span>
      ) : extra?.setting ? (
        <>
          <code className={CODE}>{extra.setting}</code>
          {extra.note && <span className="text-xs text-faint">{extra.note}</span>}
        </>
      ) : null}
      {extra?.docs && (
        <a
          href={extra.docs}
          target="_blank"
          rel="noreferrer"
          aria-label={`${supplier.name} docs (opens in a new tab)`}
          className="inline-flex items-center gap-1 rounded-[4px] text-xs text-primary hover:underline hover:underline-offset-4"
        >
          Docs
          <ArrowUpRight size={12} aria-hidden="true" />
        </a>
      )}
    </span>
  );
}

function nameColumn(header: string): DataTableColumn<SupplierStatus> {
  return {
    key: "supplier",
    header,
    sortValue: (s) => s.name,
    className: "min-w-52",
    cell: (s) => (
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="font-medium text-ink">{s.name}</span>
          <span className="font-mono text-[11px] text-faint">{s.code}</span>
        </span>
        <span className="max-w-sm whitespace-normal break-words text-xs leading-4 text-dim">{splitDetail(s.detail).about}</span>
      </div>
    ),
  };
}

const PROVIDES: DataTableColumn<SupplierStatus> = {
  key: "kind",
  header: "Provides",
  sortValue: (s) => KIND[s.kind].label,
  className: "whitespace-nowrap",
  cell: (s) => {
    const { label, icon: Icon } = KIND[s.kind];
    return (
      <span className="inline-flex items-center gap-2 text-dim">
        <Icon size={14} aria-hidden="true" className="text-faint" />
        {label}
      </span>
    );
  },
};

const STATUS: DataTableColumn<SupplierStatus> = {
  key: "status",
  header: "Status",
  sortValue: (s) => (s.connected ? 0 : 1),
  className: "whitespace-nowrap",
  cell: (s) => (
    <span className="flex flex-col items-start gap-1">
      <StatusDot
        status={s.connected ? "ok" : "unknown"}
        label={s.connected ? "Connected" : "Not connected"}
        className={s.connected ? "text-ink" : "text-dim"}
      />
      {s.mode && <Badge tone={MODE[s.mode].tone}>{MODE[s.mode].label}</Badge>}
    </span>
  ),
};

const SETUP_COLUMN: DataTableColumn<SupplierStatus> = {
  key: "setup",
  header: "Setup",
  className: "min-w-44",
  cell: (s) => <Setup supplier={s} />,
};

type HealthState = { rows: SupplierHealth[]; pending: boolean; failed: boolean };

function HealthCell({ supplier, health }: { supplier: SupplierStatus; health: HealthState }) {
  if (health.pending) return <Skeleton className="h-8 w-40" />;
  if (health.failed) return <span className="text-xs text-faint">Health unavailable</span>;
  const row = health.rows.find((h) => h.supplier === supplier.code && h.kind === supplier.kind);
  if (!row || row.calls === 0) return <span className="text-xs text-faint">No calls in the last 24 h</span>;
  const { status, word } = healthOf(row);
  const latency = latencyLine(row);
  return (
    <span className="flex flex-col items-start gap-0.5">
      <StatusDot status={status} label={word} live={false} className="text-[13px] text-ink" />
      <span className="tm-num text-xs text-dim">{callsLine(row)}</span>
      <span className="tm-num whitespace-nowrap text-xs text-faint">{latency ?? "No successful calls"}</span>
    </span>
  );
}

function bookingColumns(health: HealthState): DataTableColumn<SupplierStatus>[] {
  return [
    nameColumn("Supplier"),
    PROVIDES,
    STATUS,
    {
      key: "health",
      header: "Health (last 24 h)",
      className: "min-w-52",
      cell: (s) => <HealthCell supplier={s} health={health} />,
    },
    SETUP_COLUMN,
  ];
}

const DATA_COLUMNS: DataTableColumn<SupplierStatus>[] = [
  nameColumn("Service"),
  STATUS,
  {
    key: "used",
    header: "Used for",
    className: "min-w-44",
    cell: (s) => <span className="whitespace-normal text-xs leading-4 text-dim">{USED_FOR[s.kind] ?? "—"}</span>,
  },
  SETUP_COLUMN,
];

const STEPS = [
  "Add the variable to the API server's environment, or to backend/.env in development.",
  "Restart the API so it picks up the new value.",
  "Reload this page: the supplier shows Connected, with its mode.",
];

const MODES: { mode: keyof typeof MODE; text: string }[] = [
  { mode: "live", text: "Production access: offers and data come from the provider's live service." },
  { mode: "test", text: "A provider's test keys. Offers come from its test environment." },
  { mode: "sandbox", text: "Built-in test inventory for demos. Never bookable." },
];

/** Headline figures: connections by group and, over the last 24 h, calls and their success rate. */
function Overview({ suppliers, health }: { suppliers: SupplierStatus[] | undefined; health: HealthState }) {
  const booking = suppliers?.filter(isBooking) ?? [];
  const data = suppliers?.filter((s) => !isBooking(s)) ?? [];
  const calls = health.rows.reduce((sum, h) => sum + h.calls, 0);
  const ok = health.rows.reduce((sum, h) => sum + h.ok, 0);
  const p95 = Math.max(0, ...health.rows.map((h) => h.p95_ms ?? 0));
  const loadingSuppliers = suppliers === undefined;
  const loadingHealth = health.pending;
  return (
    <KpiStrip label="Supplier overview" columns={4}>
      <KpiTile
        label="Booking suppliers"
        value={loadingSuppliers ? "" : String(booking.filter((s) => s.connected).length)}
        unit={`of ${booking.length} connected`}
        hint="Flights and hotels"
        loading={loadingSuppliers}
      />
      <KpiTile
        label="Data services"
        value={loadingSuppliers ? "" : String(data.filter((s) => s.connected).length)}
        unit={`of ${data.length} connected`}
        hint="CO₂, fare history, exchange rates"
        loading={loadingSuppliers}
      />
      <KpiTile
        label="Supplier calls, 24 h"
        value={health.failed ? "—" : formatNumber(calls)}
        hint={health.failed ? "Health unavailable" : "Flight and hotel searches"}
        loading={loadingHealth}
      />
      <KpiTile
        label="Success rate, 24 h"
        value={health.failed || calls === 0 ? "—" : `${Math.round((ok / calls) * 1000) / 10}%`}
        hint={calls === 0 ? "No calls in the last 24 h" : p95 > 0 ? `Slowest p95 ${ms(p95)}` : "No successful calls"}
        loading={loadingHealth}
      />
    </KpiStrip>
  );
}

export function SuppliersPage() {
  const suppliers = useQuery(suppliersQueryOptions);
  const healthQuery = useQuery(supplierHealthQueryOptions("24h"));
  const health: HealthState = {
    rows: healthQuery.data?.suppliers ?? [],
    pending: healthQuery.isPending,
    failed: healthQuery.isError && !healthQuery.data,
  };
  const connected = suppliers.data?.filter((s) => s.connected).length ?? 0;
  const rows = suppliers.data ?? [];
  const empty = <EmptyState icon={PlugZap} title="No suppliers reported" description="The API returned no data sources." />;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Workspace", to: "/app" }, { label: "Suppliers" }]}
        title="Suppliers"
        description="Where prices and travel data come from. Keys are set on the server and never shown here."
        meta={
          suppliers.data && (
            <Badge tone={connected > 0 ? "ok" : "neutral"}>
              {connected} of {suppliers.data.length} connected
            </Badge>
          )
        }
      />
      <div className="flex flex-col gap-4">
        {suppliers.isError ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-[13px] leading-5 text-danger"
          >
            <CircleAlert size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
            {asApiError(suppliers.error).message}
          </p>
        ) : (
          <Overview suppliers={suppliers.data} health={health} />
        )}
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-w-0 flex-col gap-4">
            <Panel title="Booking suppliers" description="Answer fare and hotel searches with offers" flush>
              <DataTable
                caption="Booking suppliers"
                columns={bookingColumns(health)}
                rows={rows.filter(isBooking)}
                getRowId={(s) => s.code}
                loading={suppliers.isPending}
                emptyState={empty}
              />
            </Panel>
            <Panel title="Data services" description="Add CO₂, fare history and converted prices to results" flush>
              <DataTable
                caption="Data services"
                columns={DATA_COLUMNS}
                rows={rows.filter((s) => !isBooking(s))}
                getRowId={(s) => s.code}
                loading={suppliers.isPending}
                emptyState={empty}
              />
            </Panel>
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <Panel title="Connect a supplier" description="Keys live on the server, never in the browser">
              <ol className="flex flex-col gap-3">
                {STEPS.map((step, index) => (
                  <li key={step} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2 text-[13px] leading-5 text-dim">
                    <span className="tm-num grid h-5 w-5 place-items-center rounded-full border border-line-strong text-[11px] text-ink">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-4 border-t border-line pt-3 text-xs leading-4 text-faint">
                Test keys (Duffel <span className="font-mono">duffel_test_…</span>, LiteAPI <span className="font-mono">sand_…</span>) show
                as Test: their offers come from the provider's test environment.
              </p>
            </Panel>
            <Panel title="Modes" description="What the label beside a connection means">
              <dl className="flex flex-col gap-3">
                {MODES.map(({ mode, text }) => (
                  <div key={mode} className="flex flex-col items-start gap-1">
                    <dt>
                      <Badge tone={MODE[mode].tone}>{MODE[mode].label}</Badge>
                    </dt>
                    <dd className="text-xs leading-4 text-dim">{text}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}
