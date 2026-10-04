import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { History, ShieldCheck } from "lucide-react";
import { agentRunsQueryOptions } from "../../api/agent";
import { formatRelativeTime } from "../../lib/format";
import { useClock } from "../../shell/useClock";
import { cn } from "../../ui/cn";
import { Panel } from "../../ui/Panel";
import { Skeleton } from "../../ui/Skeleton";
import { PanelError } from "../command/PanelError";
import { excerpt, isVerified } from "./agentText";
import { RunStatusBadge } from "./RunStatusBadge";

/** The agency's recent plans, newest first: status, the request and its age. */
export function RunList({ activeId }: { activeId?: string }) {
  const runs = useQuery(agentRunsQueryOptions(20));
  const now = useClock(30_000);
  const items = runs.data?.items ?? [];
  return (
    <Panel
      title="Recent plans"
      icon={History}
      description={runs.data ? `${items.length} most recent · shared with your team` : "Plans your team has run"}
      flush
      busy={runs.isPending}
    >
      {runs.isPending ? (
        <div className="px-[18px] pb-[18px]">
          <Skeleton lines={6} />
        </div>
      ) : runs.isError ? (
        <div className="px-[18px] pb-[18px]">
          <PanelError error={runs.error} onRetry={() => void runs.refetch()} retrying={runs.isFetching} />
        </div>
      ) : items.length === 0 ? (
        <p className="px-[18px] pb-[18px] text-[13px] leading-5 text-dim">Plans you run are listed here, so anyone on the team can pick one up.</p>
      ) : (
        <ul className="list border-t border-line px-2 py-1.5">
          {items.map((run) => {
            const active = run.id === activeId;
            return (
              <li key={run.id}>
                <Link
                  to="/app/agent/$runId"
                  params={{ runId: run.id }}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "li relative flex-col items-stretch gap-1.5 py-2.5",
                    "before:absolute before:inset-y-2.5 before:left-0 before:w-[3px] before:rounded-full before:bg-[image:var(--grad)] before:opacity-0",
                    active && "bg-[image:var(--grad-soft)] before:opacity-100",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <RunStatusBadge status={run.status} />
                    {isVerified(run.grounded, run.result) && (
                      <ShieldCheck size={13} aria-label="Prices verified" className="shrink-0 text-ok" />
                    )}
                    <time dateTime={run.created_at} className="tm-num ml-auto shrink-0 text-[11px] text-faint">
                      {formatRelativeTime(run.created_at, now)}
                    </time>
                  </span>
                  <span className="line-clamp-2 text-[13px] leading-5 text-ink">{excerpt(run.prompt, 120)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
