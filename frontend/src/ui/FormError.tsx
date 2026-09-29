import type { ApiError } from "../api/client";

export function FormError({ error }: { error: ApiError }) {
  return (
    <div role="alert" className="rounded-sm border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
      <p>{error.message}</p>
      {error.traceId && <p className="mt-1 font-mono text-xs text-dim">Trace ID: {error.traceId}</p>}
    </div>
  );
}
