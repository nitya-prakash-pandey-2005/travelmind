import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowRightLeft,
  BedDouble,
  Building2,
  CircleCheck,
  CircleX,
  Clock3,
  Eye,
  FilePlus2,
  FileStack,
  Inbox,
  Plane,
  RefreshCw,
  Send,
  UserCheck,
  UserMinus,
  UserPen,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { activityQueryOptions, type ActivityItem } from "../../api/dashboard";
import { formatNumber, formatRelativeTime } from "../../lib/format";
import { Avatar } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Panel } from "../../ui/Panel";
import { cn } from "../../ui/cn";
import { useClock } from "../../shell/useClock";
import { ErrorPanel, PanelError } from "./PanelError";
import { LiveIndicator, LoadingPanel } from "./panelParts";

const TITLE = "Live activity";
const DESCRIPTION = "What your team did, newest first";

/** Kind icons are neutral; only outcomes a person should notice carry a status colour. */
export type KindStyle = { icon: LucideIcon; tone?: string };

const KINDS: Record<string, KindStyle> = {
  "search.flights": { icon: Plane },
  "search.hotels": { icon: BedDouble },
  "supplier.price_checked": { icon: RefreshCw },
  "client.created": { icon: UserPlus },
  "client.updated": { icon: UserPen },
  "client.deleted": { icon: UserMinus },
  "enquiry.created": { icon: Inbox },
  "enquiry.status_changed": { icon: ArrowRightLeft },
  "enquiry.assigned": { icon: UserCheck },
  "quote.created": { icon: FilePlus2 },
  "quote.version_added": { icon: FileStack },
  "quote.sent": { icon: Send },
  "quote.viewed": { icon: Eye },
  "quote.accepted": { icon: CircleCheck, tone: "text-ok" },
  "quote.declined": { icon: CircleX, tone: "text-danger" },
  "quote.expired": { icon: Clock3 },
  "team.joined": { icon: Users },
  "agency.updated": { icon: Building2 },
};
const GENERIC: KindStyle = { icon: Activity };

/** The icon (and outcome colour, if any) for an activity kind; unknown kinds get a generic icon. */
export function activityKindStyle(kind: string): KindStyle {
  return KINDS[kind] ?? GENERIC;
}

const ROW = "grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-x-3";

function FeedItem({ item, now }: { item: ActivityItem; now: Date }) {
  const { icon: Icon, tone } = KINDS[item.kind] ?? GENERIC;
  return (
    <li className={cn(ROW, "border-b border-line px-4 py-2 transition-colors duration-100 ease-tm last:border-b-0 hover:bg-hover")}>
      {item.actor ? (
        <Avatar name={item.actor.full_name} size="sm" />
      ) : (
        <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-full border border-line bg-surface-2 text-faint">
          <Activity size={12} strokeWidth={1.75} />
        </span>
      )}
      <p className="flex min-w-0 items-start gap-2 pt-0.5 text-[13px] leading-5 text-ink">
        <Icon size={14} strokeWidth={1.75} aria-hidden="true" className={cn("mt-[3px] shrink-0", tone ?? "text-faint")} />
        <span className="min-w-0 break-words">{item.summary}</span>
      </p>
      <time dateTime={item.occurred_at} className="whitespace-nowrap pt-0.5 font-mono text-[11px] leading-5 tabular-nums text-dim">
        {formatRelativeTime(item.occurred_at, now)}
      </time>
    </li>
  );
}

export function ActivityFeedPanel({ className }: { className?: string }) {
  const feed = useInfiniteQuery(activityQueryOptions);
  // Re-reads "5 min ago" between polls.
  const now = useClock(30_000);
  const live = <LiveIndicator every="20 seconds" />;

  if (feed.isPending) return <LoadingPanel title={TITLE} description={DESCRIPTION} actions={live} rows={8} className={className} />;
  if (feed.isError && !feed.data) {
    return (
      <ErrorPanel
        title={TITLE}
        description={DESCRIPTION}
        error={feed.error}
        onRetry={() => void feed.refetch()}
        retrying={feed.isFetching}
        className={className}
        actions={live}
      />
    );
  }

  const items = feed.data.pages.flatMap((page) => page.items);
  const more = feed.hasNextPage && !feed.isFetchNextPageError;

  return (
    <Panel
      title={TITLE}
      description={DESCRIPTION}
      flush
      className={cn("flex flex-col", className)}
      actions={live}
      footer={
        items.length > 0 && (
          <div className="flex w-full items-center justify-between gap-3">
            <span className="font-mono text-[11px] tabular-nums text-faint">
              {formatNumber(items.length)} {items.length === 1 ? "event" : "events"}
            </span>
            {more && (
              <Button variant="secondary" size="sm" loading={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
                Load more
              </Button>
            )}
          </div>
        )
      }
    >
      {items.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No activity yet"
          description="Searches, enquiries and quotes from your team appear here as they happen."
          action={{ label: "Search fares", to: "/app/fares" }}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col border-t border-line">
          <div aria-hidden="true" className={cn(ROW, "border-b border-line px-4 py-1.5")}>
            <span className="tm-micro">Who</span>
            <span className="tm-micro">Event</span>
            <span className="tm-micro text-right">When</span>
          </div>
          <ol
            aria-label="Recent activity"
            tabIndex={0}
            className="max-h-[26rem] min-h-0 flex-1 overflow-y-auto focus-visible:-outline-offset-2 xl:max-h-none"
          >
            {items.map((item) => (
              <FeedItem key={item.id} item={item} now={now} />
            ))}
          </ol>
          {feed.isFetchNextPageError && (
            <PanelError
              className="mx-4 my-3"
              error={feed.error}
              onRetry={() => void feed.fetchNextPage()}
              retrying={feed.isFetchingNextPage}
            />
          )}
        </div>
      )}
    </Panel>
  );
}
