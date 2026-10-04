import type { AgentRunStatus } from "../../api/agent";
import { cn } from "../../ui/cn";
import { RUN_STATUS } from "./agentText";

const TONE_TEXT = {
  info: "text-info",
  primary: "text-primary",
  warn: "text-warn",
  ok: "text-ok",
  danger: "text-danger",
  neutral: "text-dim",
} as const;

/** A run's status as a tinted pill (colour plus label); a run at work carries the live pulse. */
export function RunStatusBadge({ status, className }: { status: AgentRunStatus; className?: string }) {
  const { label, tone } = RUN_STATUS[status];
  const live = status === "running" || status === "queued";
  return (
    <span
      data-tone={tone}
      className={cn(
        "tm-tint inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2",
        "font-mono text-[10px] font-medium uppercase leading-none tracking-[0.06em]",
        TONE_TEXT[tone],
        className,
      )}
    >
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full bg-current", live && "tm-live")} />
      {label}
    </span>
  );
}
