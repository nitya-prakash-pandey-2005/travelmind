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
  "quote.viewed": { icon: Eye, className: "text-ai" },
  "quote.accepted": { icon: CircleCheck, className: "text-ok" },
  "quote.declined": { icon: CircleX, className: "text-danger" },
  "enquiry.assigned": { icon: UserRoundCheck, className: "text-primary" },
  "team.joined": { icon: UserPlus, className: "text-primary" },
};
const FALLBACK_ICON = { icon: Bell, className: "text-dim" };

function NotificationRow({ item }: { item: NotificationItem }) {
  const { icon: Icon, className } = KIND_ICONS[item.kind] ?? FALLBACK_ICON;
  return (
    <li className="flex gap-3 rounded-md px-3 py-2.5 transition-colors duration-150 ease-tm hover:bg-hover">
      <span
        aria-hidden="true"
        className={cn("tm-tint mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border", className)}
      >
        <Icon size={14} strokeWidth={1.9} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm leading-snug", item.read ? "text-dim" : "text-ink")}>{item.summary}</p>
        <time dateTime={item.occurred_at} className="font-mono text-[11px] text-dim">
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
 * Bell with the unread count; opening the list marks everything seen. Polls every minute
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
    mutationFn: () => workspaceApi.markNotificationsSeen(),
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
    if (unread > 0) markSeen.mutate();
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
          "relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-transparent text-dim",
          "transition-colors duration-200 ease-tm hover:border-line hover:bg-hover hover:text-ink",
          open && "border-line bg-hover text-ink",
        )}
      >
        <Bell size={17} strokeWidth={1.75} aria-hidden="true" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 font-mono text-[10px] font-semibold leading-none text-primary-ink"
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
            "tm-enter tm-edge z-40 flex flex-col rounded-lg bg-glass-strong shadow-(--tm-shadow-pop) backdrop-blur-xl",
            "fixed inset-x-3 top-14 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[22rem]",
          )}
        >
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 id={headingId} className="font-display text-sm tracking-wide text-ink">
              Notifications
            </h2>
            {unread > 0 && <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary">{unread} new</span>}
          </header>
          <div className="max-h-[min(26rem,70dvh)] overflow-y-auto p-1.5">
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
                <p className="text-sm text-dim">Notifications couldn't be loaded.</p>
                <Button variant="ghost" size="sm" onClick={() => void notifications.refetch()}>
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
