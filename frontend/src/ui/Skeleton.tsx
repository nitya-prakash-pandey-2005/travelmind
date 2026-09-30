import type { ReactNode } from "react";
import { Panel, type PanelVariant } from "./Panel";
import { cn } from "./cn";

// Staggered widths so stacked lines read as text rather than a solid block.
const LINE_WIDTHS = ["w-full", "w-11/12", "w-4/6", "w-5/6", "w-3/5", "w-2/3"];

/**
 * Loading placeholder. One bar by default (size it with `className`), or `lines` text-like bars.
 * Hidden from assistive tech: announce loading on the container instead (`aria-busy`).
 * The shimmer stops under `prefers-reduced-motion`.
 */
export function Skeleton({ className, lines }: { className?: string; lines?: number }) {
  if (lines === undefined) {
    return <div data-skeleton="" aria-hidden="true" className={cn("tm-shimmer h-4 rounded-sm", className)} />;
  }
  return (
    <div data-skeleton="" aria-hidden="true" className={cn("flex flex-col gap-2.5", className)}>
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className={cn("tm-shimmer h-3.5 rounded-sm", LINE_WIDTHS[index % LINE_WIDTHS.length])} />
      ))}
    </div>
  );
}

/** A panel in its loading state: title shown, body replaced by three skeleton lines. */
export function PanelSkeleton({
  title,
  eyebrow,
  variant = "glass",
  className,
  actions,
}: {
  title: string;
  eyebrow?: string;
  variant?: PanelVariant;
  className?: string;
  /** Controls that stay usable while the panel loads (a range switch). */
  actions?: ReactNode;
}) {
  return (
    <Panel title={title} eyebrow={eyebrow} variant={variant} busy className={className} actions={actions}>
      <span className="sr-only">Loading {title}…</span>
      <Skeleton lines={3} className="py-1" />
    </Panel>
  );
}
