import { CircleAlert, RotateCw } from "lucide-react";
import { asApiError } from "../../api/client";
import { Button } from "../../ui/Button";
import { Panel } from "../../ui/Panel";

/** Inline error for one panel: what failed, the trace id when there is one, and a Retry that refetches. */
export function PanelError({ error, onRetry, retrying = false }: { error: unknown; onRetry: () => void; retrying?: boolean }) {
  const apiError = asApiError(error);
  return (
    <div className="flex flex-col items-start gap-3 rounded-md border border-danger/40 bg-danger/5 px-3 py-3">
      <div role="alert" className="flex items-start gap-2 text-sm text-danger">
        <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p>{apiError.message}</p>
          {apiError.traceId && <p className="mt-1 font-mono text-xs text-dim">Trace ID: {apiError.traceId}</p>}
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onRetry} loading={retrying}>
        {!retrying && <RotateCw size={13} aria-hidden="true" />}
        Retry
      </Button>
    </div>
  );
}

/** A whole panel in its error state: the title stays, the body explains and offers Retry. */
export function ErrorPanel({
  title,
  eyebrow,
  error,
  onRetry,
  retrying,
  className,
}: {
  title: string;
  eyebrow?: string;
  error: unknown;
  onRetry: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <Panel variant="glass" title={title} eyebrow={eyebrow} className={className}>
      <PanelError error={error} onRetry={onRetry} retrying={retrying} />
    </Panel>
  );
}
