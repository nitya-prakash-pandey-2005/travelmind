import { useQuery } from "@tanstack/react-query";
import { Link, type LinkProps } from "@tanstack/react-router";
import { ArrowRight, Circle, CircleCheck, X } from "lucide-react";
import { useState } from "react";
import { onboardingQueryOptions, type OnboardingItem } from "../../api/workspace";
import { APP_HOME } from "../../app/paths";
import { Badge } from "../../ui/Badge";
import { Panel } from "../../ui/Panel";
import { PanelSkeleton } from "../../ui/Skeleton";
import { cn } from "../../ui/cn";
import { ErrorPanel } from "./PanelError";

const TITLE = "Get set up";
const EYEBROW = "Launch checklist";

const storageKey = (agencyId: string) => `tm-onboarding-dismissed:${agencyId}`;

function readDismissed(agencyId: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(agencyId)) === "1";
  } catch {
    return false;
  }
}

function saveDismissed(agencyId: string): void {
  try {
    window.localStorage.setItem(storageKey(agencyId), "1");
  } catch {
    // Storage blocked: the checklist stays hidden for this page view only.
  }
}

const ITEM_BASE = "group flex w-full items-center gap-2.5 rounded-sm border border-line/70 px-3 py-2 text-left text-sm";
const ITEM_CLASS = cn(ITEM_BASE, "transition-colors duration-200 ease-tm hover:border-primary/60 hover:bg-hover");
const COMING_SOON = "Coming in the next release";

function ItemBody({ item }: { item: OnboardingItem }) {
  const Icon = item.done ? CircleCheck : Circle;
  return (
    <>
      <Icon size={16} aria-hidden="true" className={cn("shrink-0", item.done ? "text-ok" : "text-dim")} />
      <span className={cn("min-w-0 flex-1", item.done ? "text-dim line-through decoration-line" : "text-ink")}>
        {item.label}
      </span>
      <span className="sr-only">{item.done ? "(done)" : "(to do)"}</span>
      {!item.available && <Badge>{COMING_SOON}</Badge>}
      {item.available && !item.done && (
        <ArrowRight
          size={14}
          aria-hidden="true"
          className="shrink-0 text-dim transition-transform duration-200 ease-tm group-hover:translate-x-0.5 group-hover:text-primary"
        />
      )}
    </>
  );
}

/**
 * First-week setup steps, shown until all are done or the agency dismisses it (remembered per agency on
 * this device). Steps that happen on this page (adding a client) open the New enquiry dialog; steps whose
 * screens aren't built yet (`available: false`) are listed without a link.
 */
export function OnboardingChecklist({ agencyId, onNewEnquiry }: { agencyId: string; onNewEnquiry: () => void }) {
  const [dismissed, setDismissed] = useState(() => readDismissed(agencyId));
  const onboarding = useQuery({ ...onboardingQueryOptions, enabled: !dismissed });

  if (dismissed) return null;
  if (onboarding.isPending) return <PanelSkeleton title={TITLE} eyebrow={EYEBROW} />;
  if (onboarding.isError) {
    return (
      <ErrorPanel
        title={TITLE}
        eyebrow={EYEBROW}
        error={onboarding.error}
        onRetry={() => void onboarding.refetch()}
        retrying={onboarding.isFetching}
      />
    );
  }

  const { items, completed, total } = onboarding.data;
  if (total > 0 && completed >= total) return null;
  const pct = total > 0 ? Math.round((Math.min(completed, total) / total) * 100) : 0;

  return (
    <Panel
      variant="glass"
      title={TITLE}
      eyebrow={EYEBROW}
      actions={
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs tabular-nums text-dim">{`${completed} of ${total} done`}</span>
          <button
            type="button"
            aria-label="Dismiss checklist"
            onClick={() => {
              saveDismissed(agencyId);
              setDismissed(true);
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-dim transition-colors duration-200 ease-tm hover:bg-hover hover:text-ink"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      }
    >
      <div
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={completed}
        className="mb-3 h-1.5 overflow-hidden rounded-full bg-chart-grid"
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-500 ease-tm" style={{ width: `${pct}%` }} />
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <li key={item.key}>
            {!item.available || item.href === null ? (
              <div className={ITEM_BASE}>
                <ItemBody item={item} />
              </div>
            ) : item.href === APP_HOME ? (
              <button type="button" className={ITEM_CLASS} onClick={onNewEnquiry}>
                <ItemBody item={item} />
              </button>
            ) : (
              <Link to={item.href as LinkProps["to"]} className={ITEM_CLASS}>
                <ItemBody item={item} />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
