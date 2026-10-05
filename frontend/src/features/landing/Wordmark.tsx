import { cn } from "../../ui/cn";

/** The TravelMind mark: a route arc over a horizon line, drawn in the accent. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={cn("h-5 w-5 shrink-0", className)}>
      <rect x="0.5" y="0.5" width="19" height="19" rx="5" fill="var(--tm-surface-2)" stroke="var(--tm-border-strong)" />
      <path d="M4.5 13.5 Q 10 3.5 15.5 13.5" fill="none" stroke="var(--tm-primary)" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="4.5" cy="13.5" r="1.4" fill="var(--tm-primary)" />
      <circle cx="15.5" cy="13.5" r="1.4" fill="var(--tm-text)" />
    </svg>
  );
}

/** Mark plus name in the kit's display face. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-display text-[16px] font-bold tracking-[-0.02em] text-ink", className)}>
      <BrandMark />
      TravelMind
    </span>
  );
}
