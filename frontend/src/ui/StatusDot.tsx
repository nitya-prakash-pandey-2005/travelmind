import { cn } from "./cn";

export type Status = "ok" | "degraded" | "down" | "unknown";

const DOT: Record<Status, string> = {
  ok: "bg-ok",
  degraded: "bg-warn",
  down: "bg-danger",
  unknown: "bg-dim",
};

export function StatusDot({ status, label }: { status: Status; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", DOT[status], status === "ok" && "tm-blink")} />
      <span>{label}</span>
    </span>
  );
}
