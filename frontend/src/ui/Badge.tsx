import type { ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "primary" | "ok" | "warn" | "danger" | "info" | "ai";

/**
 * Each tone as the kit's badge tone: muted (neutral), pink (the accent), green, amber, rose, cyan and violet (AI).
 * The text-* class carries the colour; the kit's t-* class tints the fill and edge from it.
 */
export const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "t-muted text-dim",
  primary: "t-pink text-primary",
  ok: "t-green text-ok",
  warn: "t-amber text-warn",
  danger: "t-rose text-danger",
  info: "t-cyan text-info",
  ai: "t-violet text-ai",
};

/**
 * Small tinted label for a fact about a thing (a role, a policy flag, a provenance): the kit's pill badge.
 * For lifecycle states use StatusPill.
 */
export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span data-tone={tone} className={cn("badge shrink-0 gap-1.5 px-2.5 py-0.5 text-[11.5px] leading-[18px]", BADGE_TONES[tone], className)}>
      {children}
    </span>
  );
}
