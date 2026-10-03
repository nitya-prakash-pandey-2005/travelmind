import { CircleCheckBig, CircleSlash, FilePenLine, Inbox, Plus, Send, type LucideIcon } from "lucide-react";
import { useId, useState, type DragEvent, type ReactNode } from "react";
import type { EnquiryStatus } from "../../api/enquiries";
import { formatNumber } from "../../lib/format";
import { Button } from "../../ui/Button";
import { cn } from "../../ui/cn";
import { Skeleton } from "../../ui/Skeleton";
import { STATUS_PILL } from "../../ui/StatusPill";
import { stageLabel } from "./enquiryFacts";

/** Each stage's colour as a 2px top rule and a dot: the StatusPill tone, never colour alone. */
const TONE_RULE: Record<string, string> = {
  neutral: "before:bg-faint",
  primary: "before:bg-primary",
  info: "before:bg-info",
  ok: "before:bg-ok",
  warn: "before:bg-warn",
  danger: "before:bg-danger",
  ai: "before:bg-ai",
};
const TONE_DOT: Record<string, string> = {
  neutral: "bg-faint",
  primary: "bg-primary",
  info: "bg-info",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  ai: "bg-ai",
};

/** What an empty stage is for, and how enquiries get there. */
const EMPTY: Record<EnquiryStatus, { icon: LucideIcon; title: string; body: string }> = {
  new: { icon: Inbox, title: "No new enquiries", body: "Capture a trip request with New enquiry, or from the command palette." },
  quoting: { icon: FilePenLine, title: "Nothing being priced", body: "Move an enquiry here while you search fares and build its quote." },
  quoted: { icon: Send, title: "No quotes with clients", body: "Enquiries land here once a quote is sent to the client." },
  won: { icon: CircleCheckBig, title: "No wins yet", body: "An accepted quote moves its enquiry here." },
  lost: { icon: CircleSlash, title: "Nothing lost", body: "Enquiries closed without a booking show here with their reason." },
};

export type DropState = "idle" | "allowed" | "blocked";

type PipelineColumnProps = {
  status: EnquiryStatus;
  count: number;
  /** Formatted total of the stage's latest quotes; null when none of them has a quote. */
  value: string | null;
  /** e.g. "avg 3 d" — a short note under the header. */
  note?: string;
  /** While a card is dragged: whether this stage accepts it. */
  drop: DropState;
  onDropCard: () => void;
  onNewEnquiry?: () => void;
  /** Hidden on small screens unless it is the stage picked there. */
  hiddenOnSmall: boolean;
  children: ReactNode;
};

/**
 * One stage of the board: a header with its count and value, then its cards as a list. While a card is
 * dragged it shows whether it accepts the drop; a stage that doesn't leaves dragover alone, so the browser
 * shows the not-allowed cursor.
 */
export function PipelineColumn({ status, count, value, note, drop, onDropCard, onNewEnquiry, hiddenOnSmall, children }: PipelineColumnProps) {
  const headingId = useId();
  const [over, setOver] = useState(false);
  const tone = STATUS_PILL[status].tone;
  const label = stageLabel(status);
  const empty = EMPTY[status];
  const Icon = empty.icon;

  function onDragOver(event: DragEvent<HTMLElement>) {
    if (drop !== "allowed") return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    if (!over) setOver(true);
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    setOver(false);
    if (drop !== "allowed") return;
    event.preventDefault();
    onDropCard();
  }

  return (
    <section
      aria-labelledby={headingId}
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={onDrop}
      className={cn(
        "relative flex min-w-0 flex-col rounded-lg border bg-surface-2/40",
        "before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:rounded-t-lg",
        TONE_RULE[tone],
        "transition-[border-color,background-color,opacity] duration-150 ease-tm",
        drop === "idle" && "border-line",
        drop === "allowed" && (over ? "border-primary bg-primary/5" : "border-dashed border-primary/50"),
        drop === "blocked" && "border-line opacity-55",
        hiddenOnSmall && "max-lg:hidden",
      )}
    >
      <header className="flex flex-col gap-0.5 border-b border-line px-3 pb-2.5 pt-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id={headingId} className="flex min-w-0 items-center gap-2 text-[13px] font-semibold leading-5 text-ink">
            <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", TONE_DOT[tone])} />
            <span className="truncate">{label}</span>
          </h2>
          <span
            data-testid="stage-count"
            className="inline-flex h-5 min-w-6 items-center justify-center rounded-full border border-line bg-surface px-1.5 font-mono text-[11px] font-medium tabular-nums text-ink"
          >
            {formatNumber(count)}
            <span className="sr-only"> {count === 1 ? "enquiry" : "enquiries"}</span>
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          {value ? (
            <span data-testid="stage-value" className="tm-num text-[13px] text-dim">
              {value}
              <span className="sr-only"> quoted</span>
            </span>
          ) : (
            <span data-testid="stage-value" className="text-xs text-faint">
              No quoted value
            </span>
          )}
          {note && <span className="truncate font-mono text-[11px] text-faint">{note}</span>}
        </div>
      </header>
      <ul
        role="list"
        aria-label={`${label} enquiries`}
        className="flex min-h-40 flex-1 flex-col gap-2 p-2"
      >
        {children}
        {count === 0 && (
          <li className="flex flex-1 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line px-3 py-6 text-center">
            {drop === "allowed" ? (
              <p className="text-[13px] font-medium text-primary">Drop to move here</p>
            ) : (
              <>
                <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-md border border-line bg-surface text-faint">
                  <Icon size={15} strokeWidth={1.75} />
                </span>
                <p className="text-[13px] font-medium text-ink">{empty.title}</p>
                <p className="max-w-56 text-xs leading-4 text-dim">{empty.body}</p>
                {onNewEnquiry && (
                  <Button size="sm" variant="secondary" onClick={onNewEnquiry} className="mt-1">
                    <Plus size={14} aria-hidden="true" />
                    New enquiry
                  </Button>
                )}
              </>
            )}
          </li>
        )}
      </ul>
    </section>
  );
}

/** A stage while the board loads: the real header shape and a few card-sized blocks. */
export function PipelineColumnSkeleton({ status, cards, hiddenOnSmall }: { status: EnquiryStatus; cards: number; hiddenOnSmall: boolean }) {
  const tone = STATUS_PILL[status].tone;
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative flex min-w-0 flex-col rounded-lg border border-line bg-surface-2/40",
        "before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:rounded-t-lg",
        TONE_RULE[tone],
        hiddenOnSmall && "max-lg:hidden",
      )}
    >
      <div className="flex flex-col gap-2 border-b border-line px-3 pb-2.5 pt-3">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-ink">{stageLabel(status)}</span>
          <Skeleton className="h-5 w-6 rounded-full" />
        </div>
        <Skeleton className="h-3.5 w-20" />
      </div>
      <div className="flex min-h-40 flex-col gap-2 p-2">
        {Array.from({ length: cards }, (_, index) => (
          <div key={index} className="flex flex-col gap-2.5 rounded-md border border-line bg-surface p-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-3/4" />
            <div className="flex items-center justify-between border-t border-line pt-2">
              <Skeleton className="h-6 w-6 rounded-full" />
              <Skeleton className="h-3.5 w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
