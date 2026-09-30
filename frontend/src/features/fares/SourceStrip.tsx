import type { SourceStatus } from "../../api/offers";
import { StatusDot, type Status } from "../../ui/StatusDot";

const STATE: Record<SourceStatus["status"], { dot: Status; label: string }> = {
  ok: { dot: "ok", label: "OK" },
  error: { dot: "down", label: "Error" },
  timeout: { dot: "degraded", label: "Timeout" },
  not_configured: { dot: "unknown", label: "Not connected" },
};

/** One chip per supplier asked: how it answered, how many offers, how fast — or why not. */
export function SourceStrip({ sources }: { sources: SourceStatus[] }) {
  return (
    <ul aria-label="Supplier sweep" className="flex flex-wrap gap-2">
      {sources.map((source) => (
        <li key={source.supplier} className="flex items-center gap-2 rounded-sm border border-line px-2 py-1 font-mono text-[11px] text-dim">
          <StatusDot status={STATE[source.status].dot} label={`${source.supplier} · ${STATE[source.status].label}`} />
          <span>{source.status === "ok" ? `${source.offer_count} offer${source.offer_count === 1 ? "" : "s"} · ${source.latency_ms} ms` : source.message}</span>
        </li>
      ))}
    </ul>
  );
}
