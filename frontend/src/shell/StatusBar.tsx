import { useQuery } from "@tanstack/react-query";
import { healthQueryOptions } from "../api/queries";
import { StatusDot, type Status } from "../ui/StatusDot";
import { formatClock, useClock } from "./useClock";

const LABELS: Record<Status, string> = {
  ok: "API online",
  degraded: "API degraded",
  down: "API offline",
  unknown: "API checking…",
};

export function StatusBar() {
  const { data } = useQuery(healthQueryOptions);
  const status: Status = data ?? "unknown";
  const now = useClock();
  return (
    <footer className="col-start-2 flex items-center justify-between border-t border-line bg-deck/80 px-4 font-mono text-[11px] uppercase tracking-[0.18em] text-dim">
      <StatusDot status={status} label={LABELS[status]} />
      <div className="flex gap-4">
        <span>UTC {formatClock(now, "UTC")}</span>
        <span>IST {formatClock(now, "Asia/Kolkata")}</span>
      </div>
    </footer>
  );
}
