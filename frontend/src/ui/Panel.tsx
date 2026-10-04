import { useId, type ReactNode } from "react";
import { cn } from "./cn";

/** default and glass: a card on the page · flat: a nested panel on surface-2 (inside a card or dialog). */
export type PanelVariant = "default" | "glass" | "flat";

type PanelProps = {
  title?: string;
  /** Small uppercase label above the title. Use sparingly; `description` usually says more. */
  eyebrow?: string;
  /** One line under the title (12px, secondary text). */
  description?: ReactNode;
  actions?: ReactNode;
  /** Alias for `actions`: content aligned to the right of the header. */
  headerRight?: ReactNode;
  /** "ai" marks Copilot/AI content with the violet accent. */
  tone?: "default" | "ai";
  variant?: PanelVariant;
  /** Tighter padding for dense dashboards. */
  dense?: boolean;
  /** Body runs edge to edge (tables, lists with their own row padding); the header keeps its padding. */
  flush?: boolean;
  /** Footer row under a hairline, e.g. a "View all" link. */
  footer?: ReactNode;
  /** Heading level of the title (default 2). */
  headingLevel?: 2 | 3;
  /** Marks the panel as loading (`aria-busy`). */
  busy?: boolean;
  className?: string;
  children: ReactNode;
};

const SURFACE: Record<PanelVariant, string> = {
  default: "rounded-lg border border-line bg-surface",
  glass: "rounded-lg border border-line bg-surface",
  flat: "rounded-lg border border-line bg-surface-2",
};

/** Card: header row (title, optional description and actions), body, optional footer. 16px padding. */
export function Panel({
  title,
  eyebrow,
  description,
  actions,
  headerRight,
  tone = "default",
  variant = "default",
  dense = false,
  flush = false,
  footer,
  headingLevel = 2,
  busy = false,
  className,
  children,
}: PanelProps) {
  const titleId = useId();
  const right = actions ?? headerRight;
  const pad = dense ? "p-3" : "p-4";
  const padX = dense ? "px-3" : "px-4";
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const hasHeader = Boolean(title || eyebrow || description || right);
  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      aria-busy={busy || undefined}
      data-variant={variant}
      data-tone={tone === "ai" ? "ai" : undefined}
      className={cn("relative min-w-0", SURFACE[variant], flush ? "p-0" : pad, className)}
    >
      {tone === "ai" && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-4 -top-px h-px bg-ai/70" />
      )}
      {hasHeader && (
        <div
          className={cn(
            "flex flex-wrap items-start justify-between gap-x-3 gap-y-2",
            flush ? cn(padX, dense ? "pb-2 pt-3" : "pb-3 pt-4") : dense ? "mb-2" : "mb-3",
          )}
        >
          <div className="min-w-0">
            {eyebrow && <p className={cn("tm-micro mb-0.5", tone === "ai" && "text-ai")}>{eyebrow}</p>}
            {title && (
              <Heading
                id={titleId}
                className={cn("font-semibold text-ink", dense ? "text-sm leading-5" : "text-base leading-6")}
              >
                {title}
              </Heading>
            )}
            {description && <p className="mt-0.5 text-xs leading-4 text-dim">{description}</p>}
          </div>
          {right && <div className="flex shrink-0 flex-wrap items-center gap-2">{right}</div>}
        </div>
      )}
      {children}
      {footer && (
        <div
          className={cn(
            "flex items-center border-t border-line pt-3 text-[13px]",
            flush ? cn(padX, "pb-3") : dense ? "-mx-3 mt-3 px-3" : "-mx-4 mt-4 px-4",
          )}
        >
          {footer}
        </div>
      )}
    </section>
  );
}
