import { cn } from "./cn";

export type Status = "ok" | "degraded" | "down" | "unknown";

const DOT: Record<Status, string> = {
  ok: "text-ok",
  degraded: "text-warn",
  down: "text-danger",
  unknown: "text-faint",
};

/**
 * A status light with its label (colour is never the only signal). `live` adds the slow pulse used for
 * live signals; it is only drawn for a healthy status and stops under reduced motion.
 */
export function StatusDot({
  status,
  label,
  live = status === "ok",
  className,
}: {
  status: Status;
  label: string;
  live?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        aria-hidden="true"
        data-status={status}
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full bg-current", DOT[status], live && status === "ok" && "tm-live")}
      />
      <span>{label}</span>
    </span>
  );
}
