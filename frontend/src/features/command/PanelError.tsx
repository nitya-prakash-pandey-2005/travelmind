import { CircleAlert, RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { asApiError } from "../../api/client";
import { Button } from "../../ui/Button";
import { Panel } from "../../ui/Panel";
import { cn } from "../../ui/cn";

/** Inline error for one panel: what failed, the trace id when there is one, and a Retry that refetches. */
export function PanelError({
  error,
  onRetry,
  retrying = false,
  className,
}: {
  error: unknown;
  onRetry: () => void;
  retrying?: boolean;
  className?: string;
}) {
  const apiError = asApiError(error);
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5",
        className,
      )}
    >
      <div role="alert" className="flex min-w-0 flex-1 items-start gap-2 text-[13px] leading-5 text-danger">
        <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p>{apiError.message}</p>
          {apiError.traceId && <p className="mt-0.5 font-mono text-[11px] text-dim">Trace ID {apiError.traceId}</p>}
        </div>
      </div>
      <Button variant="secondary" size="sm" onClick={onRetry} loading={retrying}>
        {!retrying && <RotateCw size={13} aria-hidden="true" />}
        Retry
      </Button>
    </div>
  );
}

/** A whole panel in its error state: the header stays, the body explains and offers Retry. */
export function ErrorPanel({
  title,
  description,
  error,
  onRetry,
  retrying,
  className,
  actions,
}: {
  title: string;
  description?: ReactNode;
  error: unknown;
  onRetry: () => void;
  retrying?: boolean;
  className?: string;
  /** Controls that stay usable when the panel fails (a range switch). */
  actions?: ReactNode;
}) {
  return (
    <Panel title={title} description={description} className={className} actions={actions}>
      <PanelError error={error} onRetry={onRetry} retrying={retrying} />
    </Panel>
  );
}
