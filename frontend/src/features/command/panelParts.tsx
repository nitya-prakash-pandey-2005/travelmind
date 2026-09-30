import { Link, type LinkProps } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Panel } from "../../ui/Panel";
import { Skeleton } from "../../ui/Skeleton";
import { cn } from "../../ui/cn";

/** A card footer link to the full page behind a panel ("View all suppliers →"). */
export function FooterLink({ to, children }: { to: LinkProps["to"]; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="group inline-flex items-center gap-1 rounded-[4px] font-medium text-dim transition-colors duration-150 ease-tm hover:text-ink"
    >
      {children}
      <ArrowRight
        size={14}
        aria-hidden="true"
        className="transition-transform duration-150 ease-tm group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
      />
    </Link>
  );
}

/** "● Live" for data that refreshes on its own; the interval is spelled out for screen readers. */
export function LiveIndicator({ every }: { every: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-ok">
      <span aria-hidden="true" className="tm-live h-1.5 w-1.5 rounded-full bg-current" />
      Live
      <span className="sr-only">, updates every {every}</span>
    </span>
  );
}

/**
 * A card while its data loads: the real header (title, description, any controls that stay usable), and
 * skeleton rows about the height of the content, so nothing jumps when it lands.
 */
export function LoadingPanel({
  title,
  description,
  actions,
  rows = 4,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  rows?: number;
  className?: string;
}) {
  return (
    <Panel title={title} description={description} actions={actions} busy className={cn("flex flex-col", className)}>
      <span className="sr-only">Loading {title}…</span>
      <div aria-hidden="true" className="flex flex-col">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex h-9 items-center gap-3 border-b border-line last:border-b-0">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="ml-auto h-3 w-1/6" />
          </div>
        ))}
      </div>
    </Panel>
  );
}

/** Classes for a mono figure in a table cell or list row. */
export const FIGURE = "font-mono text-[13px] tabular-nums text-ink";
