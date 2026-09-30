import { useQuery } from "@tanstack/react-query";
import { asApiError } from "../../api/client";
import type { SupplierStatus } from "../../api/offers";
import { suppliersQueryOptions } from "../../api/queries";
import { Badge } from "../../ui/Badge";
import { Panel } from "../../ui/Panel";
import { StatusDot } from "../../ui/StatusDot";

const KIND: Record<SupplierStatus["kind"], string> = {
  flights: "Flights",
  hotels: "Hotels",
  emissions: "CO₂ data",
  price_history: "Fare history",
  exchange_rates: "Exchange rates",
};
const MODE = { live: { tone: "ok", label: "Live" }, test: { tone: "warn", label: "Test" }, sandbox: { tone: "ai", label: "Sandbox" } } as const;

export function SuppliersPage() {
  const suppliers = useQuery(suppliersQueryOptions);
  return (
    <Panel eyebrow="Data links" title="Suppliers">
      <p className="mb-4 max-w-2xl text-sm text-dim">
        Where TravelMind's prices and data come from. Keys are set on the server and are never shown here.
      </p>
      {suppliers.isError ? (
        <p role="alert" className="text-sm text-danger">
          {asApiError(suppliers.error).message}
        </p>
      ) : !suppliers.data ? (
        <p role="status" className="font-mono text-xs uppercase tracking-[0.2em] text-dim">
          Checking links…
        </p>
      ) : (
        // The table wraps its own text; the wrapper only guards the page from sideways scroll on the narrowest screens.
        <div className="max-w-full overflow-x-auto">
          <table aria-label="Supplier connections" className="w-full text-left text-sm">
            <thead className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">
              <tr>
                <th className="py-2 pr-4 font-normal">Supplier</th>
                <th className="py-2 pr-4 font-normal">Provides</th>
                <th className="py-2 pr-4 font-normal">Link</th>
                <th className="py-2 font-normal">Mode</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.data.map((s) => (
                <tr key={s.code} className="border-t border-line align-top">
                  <td className="py-3 pr-4">
                    <p className="text-ink">{s.name}</p>
                    <p className="break-words text-xs text-dim">{s.detail}</p>
                  </td>
                  <td className="py-3 pr-4 text-dim">{KIND[s.kind]}</td>
                  <td className="py-3 pr-4 text-dim">
                    <StatusDot status={s.connected ? "ok" : "unknown"} label={s.connected ? "Connected" : "Not connected"} />
                  </td>
                  <td className="py-3">
                    {s.mode ? <Badge tone={MODE[s.mode].tone}>{MODE[s.mode].label}</Badge> : <span className="text-dim">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
