import type { LucideIcon } from "lucide-react";
import { useId, type ReactNode } from "react";
import { cn } from "./cn";

/** default and glass: the kit's glass card on the page · flat: a quieter nested tile (inside a card or dialog). */
export type PanelVariant = "default" | "glass" | "flat";

type PanelProps = {
  title?: string;
  /** Small HUD label above the title. Use sparingly; `description` usually says more. */
  eyebrow?: string;
  /** One line under the title (12px, secondary text). */
  description?: ReactNode;
  /** The kit's icon chip at the start of the header. */
  icon?: LucideIcon;
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

// default/glass: the kit `.card` (glass fill, 22px radius, blur, inner highlight). flat: a nested tile without blur.
const SURFACE: Record<PanelVariant, string> = {
  default: "card",
  glass: "card",
  flat: "rounded-[16px] border border-line bg-card-2",
};

/** Kit card: header row (icon chip, title, optional description and actions), body, optional footer. 18px padding. */
export function Panel({
  title,
  eyebrow,
  description,
  icon: Icon,
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
  const pad = dense ? "p-3" : "p-[18px]";
  const padX = dense ? "px-3" : "px-[18px]";
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const hasHeader = Boolean(title || eyebrow || description || right || Icon);
  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      aria-busy={busy || undefined}
      data-variant={variant}
      data-tone={tone === "ai" ? "ai" : undefined}
      className={cn("relative min-w-0", SURFACE[variant], flush ? "p-0" : pad, className)}
    >
      {tone === "ai" && <span aria-hidden="true" className="pointer-events-none absolute inset-x-6 -top-px h-px bg-ai/70" />}
      {hasHeader && (
        <div
          className={cn(
            "flex flex-wrap items-start justify-between gap-x-3 gap-y-2",
            flush ? cn(padX, dense ? "pb-2 pt-3" : "pb-3.5 pt-[18px]") : dense ? "mb-2" : "mb-3.5",
          )}
        >
          <div className="flex min-w-0 items-start gap-2.5">
            {Icon && (
              <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-card-2 text-dim">
                <Icon size={17} strokeWidth={1.75} />
              </span>
            )}
            <div className="min-w-0">
              {eyebrow && <p className={cn("tm-micro mb-1", tone === "ai" && "text-ai")}>{eyebrow}</p>}
              {title && (
                <Heading
                  id={titleId}
                  className={cn("font-display font-semibold tracking-[-0.01em] text-ink", dense ? "text-sm leading-5" : "text-base leading-6")}
                >
                  {title}
                </Heading>
              )}
              {description && <p className="mt-0.5 text-xs leading-4 text-dim">{description}</p>}
            </div>
          </div>
          {right && <div className="flex shrink-0 flex-wrap items-center gap-2">{right}</div>}
        </div>
      )}
      {children}
      {footer && (
        <div
          className={cn(
            "flex items-center border-t border-line pt-3 text-[13px]",
            flush ? cn(padX, "pb-3") : dense ? "-mx-3 mt-3 px-3" : "-mx-[18px] mt-4 px-[18px]",
          )}
        >
          {footer}
        </div>
      )}
    </section>
  );
}
