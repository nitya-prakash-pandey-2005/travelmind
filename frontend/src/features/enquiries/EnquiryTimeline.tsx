import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { History } from "lucide-react";
import { enquiryActivityQueryOptions } from "../../api/enquiries";
import type { Timeline } from "../../api/timeline";
import { formatRelativeTime } from "../../lib/format";
import { useClock } from "../../shell/useClock";
import { cn } from "../../ui/cn";
import { EmptyState } from "../../ui/EmptyState";
import { Panel } from "../../ui/Panel";
import { Skeleton } from "../../ui/Skeleton";
import { activityKindStyle } from "../command/ActivityFeedPanel";
import { PanelError } from "../command/PanelError";

const TITLE = "Timeline";
/** Events without an actor that the client caused from their quote link. */
const CLIENT_KINDS = new Set(["quote.viewed", "quote.accepted", "quote.declined"]);
const STAMP = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Everything that happened to the enquiry and its quotes, newest first (the last 50 events). */
export function EnquiryTimeline({ enquiryId, className }: { enquiryId: string; className?: string }) {
  const timeline = useQuery(enquiryActivityQueryOptions(enquiryId));
  return (
    <TimelinePanel
      timeline={timeline}
      className={className}
      intro="Status changes, quotes and client views"
      emptyDescription="Moves, quotes and client views will be listed here as they happen."
    />
  );
}

/** A record's activity timeline (enquiry, quote or client), newest first. */
export function TimelinePanel({
  timeline,
  intro,
  emptyDescription,
  className,
}: {
  timeline: UseQueryResult<Timeline>;
  /** The description while the timeline loads. */
  intro: string;
  emptyDescription: string;
  className?: string;
}) {
  const now = useClock(30_000);
  const count = timeline.data?.items.length ?? 0;

  return (
    <Panel
      title={TITLE}
      description={timeline.data ? `${count} event${count === 1 ? "" : "s"} · newest first` : intro}
      busy={timeline.isPending}
      className={className}
    >
      {timeline.isPending ? (
        <div aria-hidden="true" className="flex flex-col gap-4 py-1">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="flex items-start gap-3">
              <Skeleton className="h-6 w-6 rounded-full" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className={cn("h-3", index % 2 === 0 ? "w-4/5" : "w-3/5")} />
                <Skeleton className="h-2.5 w-24" />
              </div>
            </div>
          ))}
          <span className="sr-only">Loading timeline…</span>
        </div>
      ) : timeline.isError ? (
        <PanelError error={timeline.error} onRetry={() => void timeline.refetch()} retrying={timeline.isFetching} />
      ) : count === 0 ? (
        <EmptyState
          icon={History}
          title="No activity yet"
          description={emptyDescription}
          className="py-6"
        />
      ) : (
        <ol className="relative flex flex-col">
          {timeline.data.items.map((item, index) => {
            const { icon: Icon, tone } = activityKindStyle(item.kind);
            const last = index === count - 1;
            return (
              <li key={item.id} className="relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 pb-4 last:pb-0">
                {!last && <span aria-hidden="true" className="absolute bottom-0 left-3 top-7 w-px -translate-x-1/2 bg-line" />}
                <span
                  aria-hidden="true"
                  className={cn("relative grid h-6 w-6 place-items-center rounded-full border border-line bg-surface-2", tone ?? "text-dim")}
                >
                  <Icon size={12} strokeWidth={1.75} />
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className="break-words text-[13px] leading-5 text-ink">{item.summary}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs leading-4 text-dim">
                    <span>{item.actor?.full_name ?? (CLIENT_KINDS.has(item.kind) ? "Client" : "System")}</span>
                    <span aria-hidden="true" className="text-faint">
                      ·
                    </span>
                    <time dateTime={item.occurred_at} title={STAMP.format(new Date(item.occurred_at))} className="font-mono text-[11px] tabular-nums">
                      {formatRelativeTime(item.occurred_at, now)}
                    </time>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
