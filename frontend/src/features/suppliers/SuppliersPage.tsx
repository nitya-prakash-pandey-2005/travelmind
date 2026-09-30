import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, BedDouble, ChartLine, CircleAlert, Coins, Leaf, Plane, PlugZap, type LucideIcon } from "lucide-react";
import { asApiError } from "../../api/client";
import type { SupplierStatus } from "../../api/offers";
import { suppliersQueryOptions } from "../../api/queries";
import { Badge, type BadgeTone } from "../../ui/Badge";
import { DataTable, type DataTableColumn } from "../../ui/DataTable";
import { EmptyState } from "../../ui/EmptyState";
import { PageHeader } from "../../ui/PageHeader";
import { Panel } from "../../ui/Panel";
import { StatusDot } from "../../ui/StatusDot";

const KIND: Record<SupplierStatus["kind"], { label: string; icon: LucideIcon }> = {
  flights: { label: "Flights", icon: Plane },
  hotels: { label: "Hotels", icon: BedDouble },
  emissions: { label: "CO₂ data", icon: Leaf },
  price_history: { label: "Fare history", icon: ChartLine },
  exchange_rates: { label: "Exchange rates", icon: Coins },
};

const MODE: Record<NonNullable<SupplierStatus["mode"]>, { tone: BadgeTone; label: string }> = {
  live: { tone: "ok", label: "Live" },
  test: { tone: "info", label: "Test" },
  sandbox: { tone: "warn", label: "Sandbox" },
};

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

/** Splits "Hotel rates worldwide. Set TM_LITEAPI_KEY." into what it provides and the variable to set. */
function splitDetail(detail: string): { about: string; variable: string | null } {
  const match = /^(.*?)\s*Set (TM_[A-Z0-9_]+)\.\s*$/.exec(detail);
  return match ? { about: match[1] ?? "", variable: match[2] ?? null } : { about: detail, variable: null };
}

function Setup({ supplier }: { supplier: SupplierStatus }) {
  const { variable } = splitDetail(supplier.detail);
  const extra = SETUP[supplier.code];
  if (variable) {
    return (
      <span className="text-dim">
        Set <code className="rounded-[4px] border border-line bg-surface-2 px-1 py-px font-mono text-xs text-ink">{variable}</code>.
      </span>
    );
  }
  if (extra?.setting) {
    return (
      <span className="flex flex-col gap-0.5">
        <code className="w-fit rounded-[4px] border border-line bg-surface-2 px-1 py-px font-mono text-xs text-ink">
          {extra.setting}
        </code>
        {extra.note && <span className="text-xs text-faint">{extra.note}</span>}
      </span>
    );
  }
  return <span className="text-faint">—</span>;
}

const COLUMNS: DataTableColumn<SupplierStatus>[] = [
  {
    key: "supplier",
    header: "Supplier",
    sortValue: (s) => s.name,
    className: "min-w-56",
    cell: (s) => (
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="font-medium text-ink">{s.name}</span>
          <span className="font-mono text-[11px] text-faint">{s.code}</span>
        </span>
        <span className="max-w-md whitespace-normal break-words text-xs leading-4 text-dim">{splitDetail(s.detail).about}</span>
      </div>
    ),
  },
  {
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
  },
  {
    key: "status",
    header: "Status",
    sortValue: (s) => (s.connected ? 0 : 1),
    className: "whitespace-nowrap",
    cell: (s) => (
      <StatusDot
        status={s.connected ? "ok" : "unknown"}
        label={s.connected ? "Connected" : "Not connected"}
        className={s.connected ? "text-ink" : "text-dim"}
      />
    ),
  },
  {
    key: "mode",
    header: "Mode",
    cell: (s) => (s.mode ? <Badge tone={MODE[s.mode].tone}>{MODE[s.mode].label}</Badge> : <span className="text-faint">—</span>),
  },
  {
    key: "setup",
    header: "Setup",
    className: "min-w-44",
    cell: (s) => <Setup supplier={s} />,
  },
  {
    key: "docs",
    header: "Docs",
    className: "whitespace-nowrap",
    cell: (s) => {
      const docs = SETUP[s.code]?.docs;
      return docs ? (
        <a
          href={docs}
          target="_blank"
          rel="noreferrer"
          aria-label={`${s.name} docs (opens in a new tab)`}
          className="inline-flex items-center gap-1 rounded-[4px] text-primary hover:underline hover:underline-offset-4"
        >
          Docs
          <ArrowUpRight size={13} aria-hidden="true" />
        </a>
      ) : (
        <span className="text-faint">—</span>
      );
    },
  },
];

const STEPS = [
  "Add the variable to the API server's environment, or to backend/.env in development.",
  "Restart the API so it picks up the new value.",
  "Reload this page: the supplier shows Connected, with its mode.",
];

export function SuppliersPage() {
  const suppliers = useQuery(suppliersQueryOptions);
  const connected = suppliers.data?.filter((s) => s.connected).length ?? 0;
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
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel title="Connections" description="Status, mode and setup for each data source" flush>
          {suppliers.isError ? (
            <p role="alert" className="flex items-start gap-2 px-4 pb-4 text-[13px] leading-5 text-danger">
              <CircleAlert size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
              {asApiError(suppliers.error).message}
            </p>
          ) : (
            <DataTable
              caption="Supplier connections"
              columns={COLUMNS}
              rows={suppliers.data ?? []}
              getRowId={(s) => s.code}
              loading={suppliers.isPending}
              emptyState={<EmptyState icon={PlugZap} title="No suppliers reported" description="The API returned no data sources." />}
            />
          )}
        </Panel>
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
            Test keys (Duffel <span className="font-mono">duffel_test_…</span>, LiteAPI <span className="font-mono">sand_…</span>) show as
            Test: their offers come from the provider's test environment.
          </p>
        </Panel>
      </div>
    </>
  );
}
