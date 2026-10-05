import type { AgentRunStatus } from "../../api/agent";
import { Badge } from "../../ui/Badge";
import { cn } from "../../ui/cn";
import { RUN_STATUS } from "./agentText";

/** A run's status as a kit badge in its tone (colour plus label); a run at work carries the live pulse. */
export function RunStatusBadge({ status, className }: { status: AgentRunStatus; className?: string }) {
  const { label, tone } = RUN_STATUS[status];
  const live = status === "running" || status === "queued";
  return (
    <Badge tone={tone} className={cn("px-2 font-mono text-[10px] font-medium uppercase tracking-[0.06em]", className)}>
      <span aria-hidden="true" className={cn("dot h-1.5! w-1.5!", live && "tm-live")} />
      {label}
    </Badge>
  );
}
