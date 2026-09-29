import { useId, type ReactNode } from "react";
import { cn } from "./cn";

type PanelProps = {
  title?: string;
  eyebrow?: string;
  actions?: ReactNode;
  tone?: "default" | "ai";
  className?: string;
  children: ReactNode;
};

const CORNERS = [
  "-left-px -top-px border-l-2 border-t-2",
  "-right-px -top-px border-r-2 border-t-2",
  "-bottom-px -left-px border-b-2 border-l-2",
  "-bottom-px -right-px border-b-2 border-r-2",
];

/** HUD-style instrument panel: bracketed corners, eyebrow label, optional header actions. */
export function Panel({ title, eyebrow, actions, tone = "default", className, children }: PanelProps) {
  const titleId = useId();
  const accent = tone === "ai" ? "border-ai/70" : "border-primary/70";
  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      className={cn("relative rounded-sm border border-line bg-deck/85 p-4 backdrop-blur-sm", className)}
    >
      {CORNERS.map((corner) => (
        <span key={corner} aria-hidden="true" className={cn("pointer-events-none absolute h-3 w-3", corner, accent)} />
      ))}
      {(title || eyebrow || actions) && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            {eyebrow && (
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">{eyebrow}</p>
            )}
            {title && (
              <h2 id={titleId} className="font-display text-lg tracking-wide text-ink">
                {title}
              </h2>
            )}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
