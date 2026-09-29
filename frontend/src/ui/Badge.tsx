import type { ReactNode } from "react";
import { cn } from "./cn";

type Tone = "neutral" | "primary" | "ok" | "warn" | "danger" | "ai";

const TONES: Record<Tone, string> = {
  neutral: "border-line text-dim",
  primary: "border-primary/50 text-primary",
  ok: "border-ok/50 text-ok",
  warn: "border-warn/50 text-warn",
  danger: "border-danger/50 text-danger",
  ai: "border-ai/50 text-ai",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em]",
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}
