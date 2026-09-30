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
import { formatRelativeTime } from "../../lib/format";
import { Avatar } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Panel } from "../../ui/Panel";
import { PanelSkeleton } from "../../ui/Skeleton";
import { cn } from "../../ui/cn";
import { useClock } from "../../shell/useClock";
import { ErrorPanel, PanelError } from "./PanelError";

const TITLE = "Live activity";
const EYEBROW = "Team feed";

type KindStyle = { icon: LucideIcon; tone: string };

const KINDS: Record<string, KindStyle> = {
  "search.flights": { icon: Plane, tone: "text-primary" },
  "search.hotels": { icon: BedDouble, tone: "text-primary" },
  "supplier.price_checked": { icon: RefreshCw, tone: "text-primary" },
  "client.created": { icon: UserPlus, tone: "text-ai" },
  "client.updated": { icon: UserPen, tone: "text-ai" },
  "client.deleted": { icon: UserMinus, tone: "text-dim" },
  "enquiry.created": { icon: Inbox, tone: "text-ai" },
  "enquiry.status_changed": { icon: ArrowRightLeft, tone: "text-ai" },
  "enquiry.assigned": { icon: UserCheck, tone: "text-ai" },
  "quote.created": { icon: FilePlus2, tone: "text-warn" },
  "quote.version_added": { icon: FileStack, tone: "text-warn" },
  "quote.sent": { icon: Send, tone: "text-warn" },
  "quote.viewed": { icon: Eye, tone: "text-warn" },
  "quote.accepted": { icon: CircleCheck, tone: "text-ok" },
  "quote.declined": { icon: CircleX, tone: "text-danger" },
  "quote.expired": { icon: Clock3, tone: "text-dim" },
  "team.joined": { icon: Users, tone: "text-ok" },
  "agency.updated": { icon: Building2, tone: "text-dim" },
};
const GENERIC: KindStyle = { icon: Activity, tone: "text-dim" };

function FeedItem({ item, now }: { item: ActivityItem; now: Date }) {
  const { icon: Icon, tone } = KINDS[item.kind] ?? GENERIC;
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {/* The rail joining this event to the next. */}
      <span aria-hidden="true" className="absolute bottom-0 left-[15px] top-8 w-px bg-line [li:last-child>&]:hidden" />
      <span
        aria-hidden="true"
        className={cn("tm-tint relative grid h-8 w-8 shrink-0 place-items-center rounded-full border", tone)}
      >
        <Icon size={15} strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="break-words text-sm text-ink">{item.summary}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-dim">
          {item.actor && (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Avatar name={item.actor.full_name} size="sm" />
              <span className="truncate">{item.actor.full_name}</span>
            </span>
          )}
          {item.actor && <span aria-hidden="true">·</span>}
          <time dateTime={item.occurred_at} className="font-mono">
            {formatRelativeTime(item.occurred_at, now)}
          </time>
        </p>
      </div>
    </li>
  );
}

export function ActivityFeedPanel({ className }: { className?: string }) {
  const feed = useInfiniteQuery(activityQueryOptions);
  // Re-reads "5 min ago" between polls.
  const now = useClock(30_000);

  if (feed.isPending) return <PanelSkeleton title={TITLE} eyebrow={EYEBROW} className={className} />;
  if (feed.isError && !feed.data) {
    return (
      <ErrorPanel
        title={TITLE}
        eyebrow={EYEBROW}
        error={feed.error}
        onRetry={() => void feed.refetch()}
        retrying={feed.isFetching}
        className={className}
      />
    );
  }

  const items = feed.data.pages.flatMap((page) => page.items);

  return (
    <Panel
      variant="glass"
      title={TITLE}
      eyebrow={EYEBROW}
      className={cn("flex flex-col", className)}
      actions={
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ok">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ok tm-blink" />
          Live
          <span className="sr-only">, updates every 20 seconds</span>
        </span>
      }
    >
      {items.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No activity yet"
          description="Searches, enquiries and quotes from your team stream in here as they happen."
          action={{ label: "Run a fare scan", to: "/app/fares" }}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <ol
            aria-label="Recent activity"
            tabIndex={0}
            className="max-h-[27rem] min-h-0 flex-1 overflow-y-auto rounded-sm pr-1 focus-visible:outline-offset-2"
          >
            {items.map((item) => (
              <FeedItem key={item.id} item={item} now={now} />
            ))}
          </ol>
          {feed.isFetchNextPageError && (
            <PanelError error={feed.error} onRetry={() => void feed.fetchNextPage()} retrying={feed.isFetchingNextPage} />
          )}
          {feed.hasNextPage && !feed.isFetchNextPageError && (
            <Button
              variant="ghost"
              size="sm"
              className="self-center"
              loading={feed.isFetchingNextPage}
              onClick={() => void feed.fetchNextPage()}
            >
              Load more
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
}
