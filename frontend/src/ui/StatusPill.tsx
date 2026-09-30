import { cn } from "./cn";

export type EnquiryStatus = "new" | "quoting" | "quoted" | "won" | "lost";
export type QuoteStatus = "draft" | "sent" | "viewed" | "accepted" | "declined" | "expired";
export type PillStatus = EnquiryStatus | QuoteStatus;
export type PillTone = "neutral" | "primary" | "ok" | "warn" | "danger" | "ai";

export const STATUS_PILL: Record<PillStatus, { label: string; tone: PillTone }> = {
  new: { label: "New", tone: "primary" },
  quoting: { label: "Quoting", tone: "ai" },
  quoted: { label: "Quoted", tone: "warn" },
  won: { label: "Won", tone: "ok" },
  lost: { label: "Lost", tone: "neutral" },
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Sent", tone: "primary" },
  viewed: { label: "Viewed", tone: "ai" },
  accepted: { label: "Accepted", tone: "ok" },
  declined: { label: "Declined", tone: "danger" },
  expired: { label: "Expired", tone: "neutral" },
};

const TONE_TEXT: Record<PillTone, string> = {
  neutral: "text-dim",
  primary: "text-primary",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  ai: "text-ai",
};

/** Enquiry / quote lifecycle status as a tinted pill: colour plus label, never colour alone. */
export function StatusPill({ status, className }: { status: PillStatus; className?: string }) {
  const { label, tone } = STATUS_PILL[status];
  return (
    <span
      data-tone={tone}
      className={cn(
        "tm-tint inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5",
        "font-mono text-[11px] font-medium uppercase leading-4 tracking-[0.12em]",
        TONE_TEXT[tone],
        className,
      )}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
