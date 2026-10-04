import type { ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "primary" | "ok" | "warn" | "danger" | "info" | "ai";

const TONES: Record<BadgeTone, string> = {
  neutral: "text-dim",
  primary: "text-primary",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  info: "text-info",
  ai: "text-ai",
};

/**
 * Small tinted label for a fact about a thing (a role, a policy flag, a provenance). Mono micro type,
 * uppercase like status pills. For lifecycle states use StatusPill.
 */
export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span
      data-tone={tone}
      className={cn(
        "tm-tint inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-[4px] border px-1.5",
        "font-mono text-[10px] font-medium uppercase leading-none tracking-[0.06em]",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
