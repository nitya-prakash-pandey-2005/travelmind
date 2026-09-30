import { useQuery } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { agencyQueryOptions } from "../api/workspace";
import { useExitDemo } from "../auth/useExitDemo";
import { Button } from "../ui/Button";

const DAY_MS = 86_400_000;

/** Whole days until the demo is deleted (rounded up), or null when unknown. */
export function daysUntil(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - now.getTime()) / DAY_MS));
}

export function demoNotice(days: number | null): string {
  const base = "You're exploring a demo workspace with sample data.";
  if (days === null) return base;
  if (days === 0) return `${base} It's deleted automatically today.`;
  return `${base} It's deleted automatically in ${days} ${days === 1 ? "day" : "days"}.`;
}

/** Slim notice above the page in a demo workspace, with the way out. */
export function DemoBanner() {
  const agency = useQuery(agencyQueryOptions);
  const exit = useExitDemo();
  return (
    <div
      role="region"
      aria-label="Demo workspace"
      className="flex shrink-0 items-center gap-3 border-b border-warn/40 bg-warn/10 px-4 py-1.5 lg:px-6"
    >
      <FlaskConical size={15} aria-hidden="true" className="shrink-0 text-warn" />
      <p className="min-w-0 flex-1 text-xs leading-snug text-ink sm:text-sm">
        {demoNotice(daysUntil(agency.data?.demo_expires_at))}
      </p>
      <Button variant="ghost" size="sm" loading={exit.isPending} onClick={() => exit.mutate()} className="shrink-0">
        Exit demo
      </Button>
    </div>
  );
}
