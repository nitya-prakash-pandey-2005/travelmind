import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CircleAlert, PlugZap } from "lucide-react";
import { asApiError } from "../../api/client";
import { supplierHealthQueryOptions, type SupplierHealth } from "../../api/dashboard";
import type { SupplierStatus } from "../../api/offers";
import { suppliersQueryOptions } from "../../api/queries";
import { Badge } from "../../ui/Badge";
import { Panel } from "../../ui/Panel";
import { Skeleton } from "../../ui/Skeleton";
import { StatusDot } from "../../ui/StatusDot";
import { KIND, MODE, callsLine, latencyLine, type SupplierKind } from "../suppliers/supplierMeta";

function Row({ supplier, health }: { supplier: SupplierStatus; health?: SupplierHealth }) {
  const latency = health ? latencyLine(health) : null;
  return (
    <li className="li flex-col items-stretch gap-0.5 px-0 py-2.5">
      <span className="flex min-w-0 items-center justify-between gap-2">
        <StatusDot
          status={supplier.connected ? "ok" : "unknown"}
          label={supplier.name}
          className={supplier.connected ? "min-w-0 text-[13px] text-ink" : "min-w-0 text-[13px] text-dim"}
        />
        {supplier.mode ? (
          <Badge tone={MODE[supplier.mode].tone}>{MODE[supplier.mode].label}</Badge>
        ) : (
          <span className="shrink-0 text-xs text-faint">Not connected</span>
        )}
      </span>
      <span className="pl-3.5 text-xs leading-4 text-dim">
        {KIND[supplier.kind].label}
        {health && health.calls > 0 && (
          <>
            {" · "}
            <span className="tm-num">{callsLine(health)}</span>
            {latency && <span className="tm-num block text-faint">{latency} (24 h)</span>}
          </>
        )}
      </span>
    </li>
  );
}

function Group({ title, rows, health }: { title: string; rows: SupplierStatus[]; health: SupplierHealth[] }) {
  if (rows.length === 0) return null;
  const connected = rows.filter((s) => s.connected).length;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="hud">{title}</h3>
        <span className="tm-num text-[11px] text-dim">{`${connected} of ${rows.length} connected`}</span>
      </div>
      <ul aria-label={title} className="list">
        {rows.map((s) => (
          <Row key={s.code} supplier={s} health={health.find((h) => h.supplier === s.code && h.kind === s.kind)} />
        ))}
      </ul>
    </div>
  );
}

/**
 * Which suppliers answer this search and which data services add to its results, straight from the
 * server's supplier list, with each booking supplier's calls and latency over the last 24 hours.
 */
export function SupplierStatusCard({
  booking,
  bookingTitle,
  services,
}: {
  booking: SupplierKind;
  bookingTitle: string;
  /** Data services that add to these results (CO₂, fare history, exchange rates). */
  services: SupplierKind[];
}) {
  const suppliers = useQuery(suppliersQueryOptions);
  const health = useQuery(supplierHealthQueryOptions("24h"));
  const all = suppliers.data ?? [];
  const bookers = all.filter((s) => s.kind === booking);
  const data = all.filter((s) => services.includes(s.kind));
  const live = bookers.filter((s) => s.connected).length;

  return (
    <Panel
      title="Supplier status"
      icon={PlugZap}
      description="Who answers this search, and the data added to results"
      footer={
        <Link to="/app/suppliers" className="text-primary hover:underline hover:underline-offset-4">
          Manage suppliers
        </Link>
      }
    >
      {suppliers.isPending ? (
        <div aria-hidden="true" className="flex flex-col gap-3">
          <Skeleton lines={2} />
          <Skeleton lines={2} />
          <Skeleton lines={2} />
        </div>
      ) : suppliers.isError ? (
        <p className="flex items-start gap-2 text-[13px] leading-5 text-dim">
          <CircleAlert size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
          {`Couldn't load supplier status. ${asApiError(suppliers.error).message}`}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <Group title={bookingTitle} rows={bookers} health={health.data?.suppliers ?? []} />
          <Group title="Data in results" rows={data} health={[]} />
          {bookers.length > 0 && live === 0 && (
            <p className="text-xs leading-4 text-warn">
              No {KIND[booking].label.toLowerCase()} supplier is connected, so a search returns no offers.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
