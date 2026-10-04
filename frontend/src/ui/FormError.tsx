import { CircleAlert } from "lucide-react";
import type { ApiError } from "../api/client";

export function FormError({ error }: { error: ApiError }) {
  return (
    <div role="alert" className="flex gap-2.5 rounded-[14px] border border-danger/40 bg-danger/10 px-3.5 py-3 text-[13px] leading-5 text-ink">
      <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
      <div className="min-w-0">
        <p>{error.message}</p>
        {error.traceId && <p className="mt-0.5 font-mono text-xs text-dim">Trace ID: {error.traceId}</p>}
      </div>
    </div>
  );
}
