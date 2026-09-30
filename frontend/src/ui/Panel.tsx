import { useId, type ReactNode } from "react";
import { cn } from "./cn";

export type PanelVariant = "default" | "glass" | "flat";

type PanelProps = {
  title?: string;
  eyebrow?: string;
  actions?: ReactNode;
  /** Alias for `actions`: content aligned to the right of the header. */
  headerRight?: ReactNode;
  tone?: "default" | "ai";
  /** default: bracketed HUD panel · glass: layered glass with a gradient hairline · flat: plain inset surface. */
  variant?: PanelVariant;
  /** Tighter padding for dense dashboards. */
  dense?: boolean;
  /** Marks the panel as loading (`aria-busy`). */
  busy?: boolean;
  className?: string;
  children: ReactNode;
};

const CORNERS = [
  "-left-px -top-px border-l-2 border-t-2",
  "-right-px -top-px border-r-2 border-t-2",
  "-bottom-px -left-px border-b-2 border-l-2",
  "-bottom-px -right-px border-b-2 border-r-2",
];

const SURFACE: Record<PanelVariant, string> = {
  default: "rounded-sm border border-line bg-deck/85 backdrop-blur-sm",
  glass: "tm-glass tm-edge rounded-md",
  flat: "rounded-md border border-line bg-deck",
};

/** Instrument panel: eyebrow label, title, optional header actions; three surface variants. */
export function Panel({
  title,
  eyebrow,
  actions,
  headerRight,
  tone = "default",
  variant = "default",
  dense = false,
  busy = false,
  className,
  children,
}: PanelProps) {
  const titleId = useId();
  const accent = tone === "ai" ? "border-ai/70" : "border-primary/70";
  const right = actions ?? headerRight;
  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      aria-busy={busy || undefined}
      data-variant={variant}
      className={cn("relative min-w-0", SURFACE[variant], dense ? "p-3" : "p-4", className)}
    >
      {variant === "default" &&
        CORNERS.map((corner) => (
          <span key={corner} aria-hidden="true" className={cn("pointer-events-none absolute h-3 w-3", corner, accent)} />
        ))}
      {variant === "glass" && (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-x-6 -top-px h-px bg-linear-to-r from-transparent to-transparent",
            tone === "ai" ? "via-ai/60" : "via-primary/60",
          )}
        />
      )}
      {(title || eyebrow || right) && (
        <div className={cn("flex flex-wrap items-start justify-between gap-x-3 gap-y-2", dense ? "mb-2" : "mb-3")}>
          <div className="min-w-0">
            {eyebrow && (
              <p
                className={cn(
                  "font-mono text-[11px] uppercase tracking-[0.22em]",
                  tone === "ai" && variant !== "default" ? "text-ai" : "text-dim",
                )}
              >
                {eyebrow}
              </p>
            )}
            {title && (
              <h2 id={titleId} className={cn("font-display tracking-wide text-ink", dense ? "text-base" : "text-lg")}>
                {title}
              </h2>
            )}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}
