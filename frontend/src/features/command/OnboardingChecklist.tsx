import { useQuery } from "@tanstack/react-query";
import { Link, type LinkProps } from "@tanstack/react-router";
import { ArrowRight, Circle, CircleCheck, X } from "lucide-react";
import { useState } from "react";
import { onboardingQueryOptions, type OnboardingItem } from "../../api/workspace";
import { APP_HOME } from "../../app/paths";
import { Button } from "../../ui/Button";
import { Panel } from "../../ui/Panel";
import { Skeleton } from "../../ui/Skeleton";
import { cn } from "../../ui/cn";
import { PanelError } from "./PanelError";

const TITLE = "Get set up";

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

const ITEM_BASE =
  "group inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-line px-2.5 text-left text-[13px] leading-none";
const ITEM_CLASS = cn(ITEM_BASE, "transition-colors duration-150 ease-tm hover:border-line-strong hover:bg-hover");

function ItemBody({ item }: { item: OnboardingItem }) {
  const Icon = item.done ? CircleCheck : Circle;
  return (
    <>
      <Icon size={14} aria-hidden="true" className={cn("shrink-0", item.done ? "text-ok" : "text-faint")} />
      <span className={cn("truncate", item.done ? "text-dim" : "text-ink")}>{item.label}</span>
      <span className="sr-only">{item.done ? "(done)" : "(to do)"}</span>
      {!item.available && (
        <span className="shrink-0 text-[11px] text-faint">
          <span aria-hidden="true">Soon</span>
          <span className="sr-only">Coming in the next release</span>
        </span>
      )}
      {item.available && !item.done && (
        <ArrowRight
          size={12}
          aria-hidden="true"
          className="shrink-0 text-faint transition-colors duration-150 ease-tm group-hover:text-ink"
        />
      )}
    </>
  );
}

/**
 * First-week setup steps as one slim card, shown until all are done or the agency dismisses it (remembered
 * per agency on this device). Steps that happen on this page (adding a client) open the New enquiry dialog;
 * steps whose screens aren't built yet (`available: false`) are listed without a link.
 */
export function OnboardingChecklist({ agencyId, onNewEnquiry }: { agencyId: string; onNewEnquiry: () => void }) {
  const [dismissed, setDismissed] = useState(() => readDismissed(agencyId));
  const onboarding = useQuery({ ...onboardingQueryOptions, enabled: !dismissed });

  if (dismissed) return null;
  if (onboarding.isPending) {
    return (
      <Panel title={TITLE} dense busy>
        <span className="sr-only">Loading setup steps…</span>
        <div aria-hidden="true" className="flex flex-wrap gap-1.5">
          {["w-36", "w-44", "w-32", "w-40"].map((width) => (
            <Skeleton key={width} className={cn("h-7 rounded-md", width)} />
          ))}
        </div>
      </Panel>
    );
  }
  if (onboarding.isError) {
    return (
      <Panel title={TITLE} dense>
        <PanelError error={onboarding.error} onRetry={() => void onboarding.refetch()} retrying={onboarding.isFetching} />
      </Panel>
    );
  }

  const { items, completed, total } = onboarding.data;
  if (total > 0 && completed >= total) return null;
  const done = Math.min(completed, total);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <Panel
      title={TITLE}
      dense
      actions={
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] tabular-nums text-dim">{`${completed} of ${total} done`}</span>
          <div
            role="progressbar"
            aria-label="Setup progress"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={completed}
            className="h-1 w-24 overflow-hidden rounded-full bg-chart-grid sm:w-32"
          >
            <div className="h-full rounded-full bg-primary transition-[width] duration-150 ease-tm" style={{ width: `${pct}%` }} />
          </div>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="Dismiss checklist"
            onClick={() => {
              saveDismissed(agencyId);
              setDismissed(true);
            }}
            className="-my-1 h-7 w-7"
          >
            <X size={14} aria-hidden="true" />
          </Button>
        </div>
      }
    >
      <ul className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <li key={item.key} className="max-w-full">
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
