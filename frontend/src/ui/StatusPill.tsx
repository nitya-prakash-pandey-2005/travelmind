import { cn } from "./cn";

export type EnquiryStatus = "new" | "quoting" | "quoted" | "won" | "lost";
export type QuoteStatus = "draft" | "sent" | "viewed" | "accepted" | "declined" | "expired";
export type PillStatus = EnquiryStatus | QuoteStatus;
export type PillTone = "neutral" | "primary" | "info" | "ok" | "warn" | "danger" | "ai";

export const STATUS_PILL: Record<PillStatus, { label: string; tone: PillTone }> = {
  new: { label: "New", tone: "info" },
  quoting: { label: "Quoting", tone: "warn" },
  quoted: { label: "Quoted", tone: "primary" },
  won: { label: "Won", tone: "ok" },
  lost: { label: "Lost", tone: "neutral" },
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Sent", tone: "info" },
  viewed: { label: "Viewed", tone: "primary" },
  accepted: { label: "Accepted", tone: "ok" },
  declined: { label: "Declined", tone: "danger" },
  expired: { label: "Expired", tone: "neutral" },
};

const TONE_TEXT: Record<PillTone, string> = {
  neutral: "text-dim",
  primary: "text-primary",
  info: "text-info",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  ai: "text-ai",
};

/**
 * Enquiry / quote lifecycle status as a tinted pill: colour plus label, never colour alone.
 * Blue = new/sent, amber = work in progress, cyan = with the client, green = won, red = declined,
 * grey = closed without a result. Violet stays reserved for AI.
 */
export function StatusPill({ status, className }: { status: PillStatus; className?: string }) {
  const { label, tone } = STATUS_PILL[status];
  return (
    <span
      data-tone={tone}
      className={cn(
        "tm-tint inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-full border px-2",
        "font-mono text-[10px] font-medium uppercase leading-none tracking-[0.06em]",
        TONE_TEXT[tone],
        className,
      )}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {label}
    </span>
  );
}
