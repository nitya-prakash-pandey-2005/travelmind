import { STATUS_PILL, StatusPill, type PillStatus } from "../../ui/StatusPill";

function isPillStatus(status: string): status is PillStatus {
  return Object.hasOwn(STATUS_PILL, status);
}

/** A record's status as a pill when it is a known lifecycle state, else as plain text. */
export function Status({ status }: { status: string }) {
  return isPillStatus(status) ? <StatusPill status={status} /> : <span className="text-sm text-ink">{status}</span>;
}

export function formatRoute(origin: string | null, destination: string | null): string {
  if (!origin && !destination) return "Route not set";
  return `${origin ?? "—"} → ${destination ?? "—"}`;
}
