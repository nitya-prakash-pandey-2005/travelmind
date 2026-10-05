import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, CircleAlert, PlugZap } from "lucide-react";
import { useId } from "react";
import { asApiError } from "../../api/client";
import { supplierHealthQueryOptions, type SupplierHealth } from "../../api/dashboard";
import type { SupplierStatus } from "../../api/offers";
import { suppliersQueryOptions } from "../../api/queries";
import { formatNumber } from "../../lib/format";
import { MiniRing, Stat } from "../../kit";
import { Badge, type BadgeTone } from "../../ui/Badge";
import { KpiStrip, KpiTile } from "../../ui/charts";
import { EmptyState } from "../../ui/EmptyState";
import { PageHeader } from "../../ui/PageHeader";
import { Panel } from "../../ui/Panel";
import { Skeleton } from "../../ui/Skeleton";
import { BREAKER, KIND, MODE, breakerOf, callsLine, healthOf, isBooking, ms } from "./supplierMeta";

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

type HealthState = { rows: SupplierHealth[]; pending: boolean; failed: boolean };

const HEALTH_TONE: Record<ReturnType<typeof healthOf>["status"], BadgeTone> = { ok: "ok", degraded: "warn", down: "danger", unknown: "neutral" };
const RING_COLOUR: Record<ReturnType<typeof healthOf>["status"], string> = {
  ok: "var(--tm-ok)",
  degraded: "var(--tm-warn)",
  down: "var(--tm-danger)",
  unknown: "var(--tm-text-3)",
};
const PCT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/** A dot badge: the kit's status badge (colour plus the word, never colour alone). */
function DotBadge({ tone, children }: { tone: BadgeTone; children: string }) {
  return (
    <Badge tone={tone}>
      <span aria-hidden="true" className="dot h-1.5! w-1.5!" />
      {children}
    </Badge>
  );
}

/** A booking supplier's last 24 hours: success rate as a ring, health and calls, then p50 and p95 latency. */
function Health({ supplier, health }: { supplier: SupplierStatus; health: HealthState }) {
  if (health.pending) return <Skeleton className="h-[54px] w-full" />;
  if (health.failed) return <p className="text-xs text-faint">Health unavailable</p>;
  const row = health.rows.find((h) => h.supplier === supplier.code && h.kind === supplier.kind);
  if (!row || row.calls === 0) return <p className="text-xs text-faint">No calls in the last 24 h</p>;
  const { status, word } = healthOf(row);
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <div className="flex min-w-0 items-center gap-3">
        <div role="img" aria-label={`${PCT.format(row.success_pct)}% of calls succeeded`}>
          <MiniRing value={row.success_pct} max={100} color={RING_COLOUR[status]} label={`${Math.round(row.success_pct)}%`} />
        </div>
        <div className="flex min-w-0 flex-col items-start gap-1">
          <DotBadge tone={HEALTH_TONE[status]}>{word}</DotBadge>
          <span className="tm-num text-xs text-dim">{callsLine(row)}</span>
        </div>
      </div>
      {row.p50_ms !== null && row.p95_ms !== null ? (
        <div className="flex gap-5">
          <Stat value={formatNumber(Math.round(row.p50_ms))} unit="ms" label="p50 latency" className="[&_.v]:text-[22px]" />
          <Stat value={formatNumber(Math.round(row.p95_ms))} unit="ms" label="p95 latency" className="[&_.v]:text-[22px]" />
        </div>
      ) : (
        <p className="text-xs text-faint">No successful calls</p>
      )}
    </div>
  );
}

/**
 * One connection as a kit card: kind icon, name and code, status, mode and circuit-breaker badges, what it provides,
 * then (booking suppliers) its health or (data services) where it is used, and how to set it up.
 */
function SupplierCard({ supplier, health }: { supplier: SupplierStatus; health?: HealthState }) {
  const titleId = useId();
  const { label, icon: Icon } = KIND[supplier.kind];
  const breaker = breakerOf(supplier);
  return (
    <li aria-labelledby={titleId} className="card flex min-w-0 flex-col gap-3.5">
      <div className="flex min-w-0 items-start gap-3">
        <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-card-2 text-dim">
          <Icon size={17} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="flex flex-wrap items-baseline gap-x-2 font-display text-[15px] font-semibold leading-5 text-ink">
            {supplier.name}
            <span className="font-mono text-[11px] font-normal text-faint">{supplier.code}</span>
          </h3>
          <p className="mt-0.5 text-xs leading-4 text-dim">{label}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <DotBadge tone={supplier.connected ? "ok" : "neutral"}>{supplier.connected ? "Connected" : "Not connected"}</DotBadge>
        {supplier.mode && <Badge tone={MODE[supplier.mode].tone}>{MODE[supplier.mode].label}</Badge>}
        {breaker && <Badge tone={BREAKER[breaker].tone}>{BREAKER[breaker].label}</Badge>}
      </div>
      <p className="text-[13px] leading-5 text-dim">{splitDetail(supplier.detail).about}</p>
      {health ? (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <p className="hud">Health (last 24 h)</p>
          <Health supplier={supplier} health={health} />
        </div>
      ) : (
        <div className="flex flex-col gap-1 border-t border-line pt-3">
          <p className="hud">Used for</p>
          <p className="text-[13px] leading-5 text-ink">{USED_FOR[supplier.kind] ?? "—"}</p>
        </div>
      )}
      <div className="mt-auto flex flex-col gap-1 border-t border-line pt-3 text-[13px]">
        <p className="hud">Setup</p>
        <Setup supplier={supplier} />
      </div>
    </li>
  );
}

/** A group of connections: a heading and its cards, two across on wide screens. */
function SupplierGroup({
  title,
  description,
  suppliers,
  loading,
  health,
}: {
  title: string;
  description: string;
  suppliers: SupplierStatus[];
  loading: boolean;
  health?: HealthState;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <div>
        <h2 id={headingId} className="font-display text-base font-semibold leading-6 text-ink">
          {title}
        </h2>
        <p className="text-xs leading-4 text-dim">{description}</p>
      </div>
      {loading ? (
        <div aria-busy="true" className="grid g2">
          {[0, 1].map((index) => (
            <div key={index} className="card">
              <Skeleton lines={4} />
            </div>
          ))}
        </div>
      ) : suppliers.length === 0 ? (
        <div className="card p-0">
          <EmptyState icon={PlugZap} title="No suppliers reported" description="The API returned no data sources." />
        </div>
      ) : (
        <ul aria-label={title} className="grid g2 items-stretch">
          {suppliers.map((supplier) => (
            <SupplierCard key={supplier.code} supplier={supplier} health={health} />
          ))}
        </ul>
      )}
    </section>
  );
}

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
            className="card alert flex items-start gap-2 text-[13px] leading-5 text-danger"
          >
            <CircleAlert size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
            {asApiError(suppliers.error).message}
          </p>
        ) : (
          <Overview suppliers={suppliers.data} health={health} />
        )}
        {/* The kit's list + detail: the connections as cards in span-8, how to connect and what modes mean in span-4. */}
        <div className="grid g-12 items-start">
          <div className="span-8 flex min-w-0 flex-col gap-6">
            <SupplierGroup
              title="Booking suppliers"
              description="Answer fare and hotel searches with offers"
              suppliers={rows.filter(isBooking)}
              loading={suppliers.isPending}
              health={health}
            />
            <SupplierGroup
              title="Data services"
              description="Add CO₂, fare history and converted prices to results"
              suppliers={rows.filter((s) => !isBooking(s))}
              loading={suppliers.isPending}
            />
          </div>
          <div className="span-4 flex min-w-0 flex-col gap-4">
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
