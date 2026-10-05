import { BADGE_TONES } from "./Badge";
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

/**
 * Enquiry / quote lifecycle status as the kit's badge with its glowing dot: colour plus label, never colour alone.
 * Blue = new/sent, amber = work in progress, cyan = with the client, green = won, red = declined,
 * grey = closed without a result. Violet stays reserved for AI.
 */
export function StatusPill({ status, className }: { status: PillStatus; className?: string }) {
  const { label, tone } = STATUS_PILL[status];
  return (
    <span
      data-tone={tone}
      className={cn("badge gap-1.5 px-2.5 py-0.5 text-[11.5px] leading-[18px]", BADGE_TONES[tone], className)}
    >
      <span aria-hidden="true" className="dot h-1.5! w-1.5!" />
      {label}
    </span>
  );
}
