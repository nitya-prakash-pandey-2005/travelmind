import type { SourceStatus } from "../../api/offers";
import { StatusDot, type Status } from "../../ui/StatusDot";

const STATE: Record<SourceStatus["status"], { dot: Status; label: string }> = {
  ok: { dot: "ok", label: "OK" },
  error: { dot: "down", label: "Error" },
  timeout: { dot: "degraded", label: "Timeout" },
  not_configured: { dot: "unknown", label: "Not connected" },
};

/** One chip per supplier asked: how it answered, how many offers, how fast, or why not. */
export function SourceStrip({ sources }: { sources: SourceStatus[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="tm-micro" aria-hidden="true">
        Supplier status
      </span>
      <ul aria-label="Supplier status" className="flex min-w-0 flex-wrap gap-1.5">
        {sources.map((source) => (
          <li
            key={source.supplier}
            className="flex min-h-7 min-w-0 flex-wrap items-center gap-x-2 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs leading-4"
          >
            <StatusDot
              status={STATE[source.status].dot}
              label={`${source.supplier} · ${STATE[source.status].label}`}
              className="font-mono text-ink"
            />
            <span className="min-w-0 break-words text-dim">
              {source.status === "ok" ? (
                <>
                  {`${source.offer_count} offer${source.offer_count === 1 ? "" : "s"} · `}
                  <span className="tm-num">{source.latency_ms} ms</span>
                </>
              ) : (
                source.message
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
