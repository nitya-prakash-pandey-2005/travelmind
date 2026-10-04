import { Link } from "@tanstack/react-router";
import { CalendarDays, FileText, MessageSquareOff, UsersRound } from "lucide-react";
import { useEffect, useRef, type DragEvent } from "react";
import type { EnquiryOut, EnquiryStatus } from "../../api/enquiries";
import type { QuoteSummary } from "../../api/quotes";
import { formatWholeMoney } from "../../lib/money";
import { Avatar } from "../../ui/Avatar";
import { cn } from "../../ui/cn";
import { STATUS_PILL } from "../../ui/StatusPill";
import {
  ageDescription,
  ageLabel,
  cabinLabel,
  enquiryName,
  routeLabel,
  travellersLabel,
  tripDates,
} from "./enquiryFacts";
import { MoveMenu } from "./MoveMenu";

const QUOTE_TONE: Record<string, string> = {
  neutral: "text-dim",
  primary: "text-primary",
  info: "text-info",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  ai: "text-ai",
};

type EnquiryCardProps = {
  enquiry: EnquiryOut;
  /** The enquiry's most recent quote, if it has one. */
  latest?: QuoteSummary;
  now: Date;
  onMove: (to: EnquiryStatus) => void;
  /** Drag and drop: set while this card is the one being dragged. */
  dragging?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  /** Set after a keyboard move lands this card in its new stage: the card takes focus, then calls onFocused. */
  focusRequested?: boolean;
  onFocused?: () => void;
};

/** The quote line at the foot of a card: number, state and value, or what the enquiry has instead. */
function QuoteLine({ enquiry, latest }: { enquiry: EnquiryOut; latest?: QuoteSummary }) {
  if (latest) {
    const pill = STATUS_PILL[latest.status];
    return (
      <span className="flex min-w-0 items-center justify-end gap-1.5 text-right" title={`${latest.number} · ${pill.label}`}>
        <span className={cn("min-w-0 truncate text-[11px] font-medium", QUOTE_TONE[pill.tone])}>{pill.label}</span>
        <span className="tm-num shrink-0 text-[13px] font-medium text-ink">
          {latest.value_minor !== null ? formatWholeMoney(latest.value_minor, latest.currency) : "—"}
        </span>
      </span>
    );
  }
  if (enquiry.budget) {
    return (
      <span className="truncate text-right text-[11px] text-dim">
        Budget <span className="tm-num text-[12px] text-ink">{formatWholeMoney(enquiry.budget.amount_minor, enquiry.budget.currency)}</span>
      </span>
    );
  }
  return <span className="truncate text-right text-[11px] text-faint">No quote yet</span>;
}

/**
 * One enquiry on the board: number and age, route (the link to the enquiry), client, dates and party,
 * then the assignee and the latest quote. Draggable to another stage; the Move menu does the same by keyboard.
 */
export function EnquiryCard({
  enquiry,
  latest,
  now,
  onMove,
  dragging = false,
  onDragStart,
  onDragEnd,
  focusRequested = false,
  onFocused,
}: EnquiryCardProps) {
  const ref = useRef<HTMLElement>(null);
  const movable = enquiry.status !== "won";
  const dates = tripDates(enquiry);
  const premium = enquiry.cabin !== "economy";

  function startDrag(event: DragEvent<HTMLElement>) {
    // Some browsers only start a drag that carries data.
    event.dataTransfer?.setData("text/plain", enquiry.number);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    onDragStart?.();
  }

  // A moved card mounts afresh in its new column, so the focus its Move menu or the Lost dialog held is gone.
  useEffect(() => {
    if (!focusRequested) return;
    ref.current?.focus();
    onFocused?.();
  }, [focusRequested, onFocused]);

  return (
    <article
      ref={ref}
      tabIndex={-1}
      aria-label={enquiryName(enquiry)}
      draggable={movable}
      onDragStart={movable ? startDrag : undefined}
      onDragEnd={movable ? onDragEnd : undefined}
      className={cn(
        "group/card relative flex flex-col gap-2 rounded-[14px] border border-line bg-card-2 p-3",
        "transition-[border-color,opacity,background-color] duration-150 ease-tm hover:border-line-strong",
        "has-[a:focus-visible]:border-primary",
        movable && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-40",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 font-mono text-[11px] leading-4 text-faint">
          <span className="truncate">{enquiry.number}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={enquiry.created_at} title={ageDescription(enquiry.created_at, now)} className="tabular-nums">
            {ageLabel(enquiry.created_at, now)}
            <span className="sr-only"> ({ageDescription(enquiry.created_at, now)})</span>
          </time>
        </span>
        {/* Above the stretched link, so the menu stays clickable. */}
        <MoveMenu
          enquiry={enquiry}
          onMove={onMove}
          className="relative z-10 -my-1 -mr-1.5 opacity-70 transition-opacity group-hover/card:opacity-100 focus-within:opacity-100"
        />
      </div>

      <div className="flex min-w-0 flex-col gap-0.5">
        <Link
          to="/app/enquiries/$enquiryId"
          params={{ enquiryId: enquiry.id }}
          draggable={false}
          className={cn(
            "truncate rounded-[4px] font-mono text-sm font-semibold tracking-[0.02em] text-ink",
            "after:absolute after:inset-0 after:rounded-[14px] focus-visible:outline-none",
          )}
        >
          {routeLabel(enquiry)}
        </Link>
        <p className={cn("truncate text-[13px] leading-5", enquiry.client ? "text-dim" : "text-faint")}>
          {enquiry.client?.name ?? "No client yet"}
        </p>
      </div>

      <dl className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-4 text-dim">
        <div className="flex min-w-0 items-center gap-1.5">
          <dt className="sr-only">Dates</dt>
          <CalendarDays size={13} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-faint" />
          <dd className={cn("truncate tabular-nums", !dates && "text-faint")}>{dates ?? "Dates not set"}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Travellers</dt>
          <UsersRound size={13} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-faint" />
          <dd className="whitespace-nowrap">{travellersLabel(enquiry)}</dd>
        </div>
        {premium && (
          <div className="flex items-center">
            <dt className="sr-only">Cabin</dt>
            <dd className="rounded-[4px] border border-line px-1 text-[11px] leading-4 text-ink">{cabinLabel(enquiry.cabin)}</dd>
          </div>
        )}
      </dl>

      {enquiry.status === "lost" && enquiry.lost_reason && (
        <p className="flex items-start gap-1.5 rounded-[4px] bg-surface-2 px-2 py-1 text-xs leading-4 text-dim">
          <MessageSquareOff size={12} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-faint" />
          <span className="min-w-0 break-words">{enquiry.lost_reason}</span>
        </p>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-line pt-2">
        {enquiry.assignee ? (
          <Avatar name={enquiry.assignee.full_name} size="sm" />
        ) : (
          <span
            title="Unassigned"
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-dashed border-line-strong text-[10px] text-faint"
          >
            <span aria-hidden="true">–</span>
            <span className="sr-only">Unassigned</span>
          </span>
        )}
        <span className="flex min-w-0 items-center justify-end gap-1.5">
          {latest && enquiry.quote_count > 1 && (
            <span title={`${enquiry.quote_count} quotes`} className="flex items-center gap-0.5 font-mono text-[11px] text-faint">
              <FileText size={11} strokeWidth={1.75} aria-hidden="true" />
              {enquiry.quote_count}
              <span className="sr-only"> quotes</span>
            </span>
          )}
          <QuoteLine enquiry={enquiry} latest={latest} />
        </span>
      </div>
    </article>
  );
}
