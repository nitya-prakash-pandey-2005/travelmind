import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CircleCheck, CircleX, Eye, UserPlus, UserRoundCheck, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { notificationsQueryOptions, workspaceApi, workspaceKeys, type NotificationItem } from "../api/workspace";
import { formatRelativeTime } from "../lib/format";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { EmptyState } from "../ui/EmptyState";
import { Skeleton } from "../ui/Skeleton";

const KIND_ICONS: Record<string, { icon: LucideIcon; className: string }> = {
  "quote.viewed": { icon: Eye, className: "text-primary" },
  "quote.accepted": { icon: CircleCheck, className: "text-ok" },
  "quote.declined": { icon: CircleX, className: "text-danger" },
  "enquiry.assigned": { icon: UserRoundCheck, className: "text-info" },
  "team.joined": { icon: UserPlus, className: "text-info" },
};
const FALLBACK_ICON = { icon: Bell, className: "text-dim" };

function NotificationRow({ item }: { item: NotificationItem }) {
  const { icon: Icon, className } = KIND_ICONS[item.kind] ?? FALLBACK_ICON;
  return (
    <li className="flex gap-3 rounded-[12px] px-2.5 py-2 transition-colors duration-100 ease-tm hover:bg-card-2">
      <span
        aria-hidden="true"
        className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-card-2", className)}
      >
        <Icon size={14} strokeWidth={1.9} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-[13px] leading-5", item.read ? "text-dim" : "text-ink")}>{item.summary}</p>
        <time dateTime={item.occurred_at} className="text-xs text-faint">
          {formatRelativeTime(item.occurred_at)}
        </time>
      </div>
      {!item.read && (
        <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary">
          <span className="sr-only">Unread</span>
        </span>
      )}
    </li>
  );
}

/**
 * Bell with the unread count; opening the list marks everything up to its newest item seen. Polls every minute
 * (see notificationsQueryOptions). A disclosure, not a menu: the list is plain content.
 */
export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const headingId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const queryClient = useQueryClient();
  const notifications = useQuery(notificationsQueryOptions);
  const markSeen = useMutation({
    mutationFn: (until?: string) => workspaceApi.markNotificationsSeen(until),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workspaceKeys.notifications }),
  });
  const unread = notifications.data?.unread ?? 0;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    // Only what the list shows is marked read: events that arrive meanwhile stay unread.
    if (unread > 0) markSeen.mutate(notifications.data?.items[0]?.occurred_at);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (open && event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    }
  }

  // Tabbing out of the list closes it; clicks on its own text (no new focus target) don't.
  function onBlur(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    if (next instanceof Node && !event.currentTarget.contains(next)) setOpen(false);
  }

  const items = notifications.data?.items ?? [];
  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={toggle}
        className={cn(
          "relative inline-flex h-9 w-9 items-center justify-center rounded-md text-dim",
          "transition-colors duration-150 ease-tm hover:bg-card-2 hover:text-ink",
          open && "bg-card-2 text-ink",
        )}
      >
        <Bell size={17} strokeWidth={1.75} aria-hidden="true" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-(image:--tm-grad) px-1 font-mono text-[9px] font-semibold leading-none text-primary-ink ring-2 ring-bg"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <section
          id={panelId}
          aria-labelledby={headingId}
          className={cn(
            "tm-enter tm-popover z-40 flex flex-col overflow-hidden rounded-[18px]",
            // Phones: full width under the top bar (its own blurred box is the containing block, or the viewport).
            "fixed inset-x-3 top-[calc(var(--topbar)+6px)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-1.5 sm:w-[22rem]",
          )}
        >
          <header className="flex h-12 items-center justify-between border-b border-line px-4">
            <h2 id={headingId} className="font-display text-[15px] font-semibold text-ink">
              Notifications
            </h2>
            {unread > 0 && <span className="font-mono text-[11px] text-primary">{unread} new</span>}
          </header>
          <div className="max-h-[min(26rem,70dvh)] overflow-y-auto p-1">
            {notifications.isPending ? (
              <div aria-busy="true" className="flex flex-col gap-3 p-2.5">
                {[0, 1, 2].map((row) => (
                  <div key={row} className="flex gap-3">
                    <Skeleton className="h-7 w-7 rounded-full" />
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Skeleton className="h-3.5 w-full" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  </div>
                ))}
              </div>
            ) : notifications.isError ? (
              <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
                <p className="text-[13px] text-dim">Notifications couldn't be loaded.</p>
                <Button variant="secondary" size="sm" onClick={() => void notifications.refetch()}>
                  Retry
                </Button>
              </div>
            ) : items.length === 0 ? (
              <EmptyState
                icon={CircleCheck}
                title="You're all caught up."
                description="Quote views, client decisions and new teammates show up here."
              />
            ) : (
              <ol className="flex flex-col">
                {items.map((item) => (
                  <NotificationRow key={item.id} item={item} />
                ))}
              </ol>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
