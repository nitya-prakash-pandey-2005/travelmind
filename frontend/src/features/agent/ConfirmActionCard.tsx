import { CircleAlert, FilePlus2, Inbox, ShieldQuestion, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import type { PendingConfirm, WriteTool } from "../../api/agent";
import { Button } from "../../ui/Button";

const TOOL: Partial<Record<WriteTool | string, { title: string; icon: typeof Inbox }>> = {
  create_enquiry: { title: "Create enquiry", icon: Inbox },
  draft_quote: { title: "Draft quote", icon: FilePlus2 },
};

/** The values the action will save, in plain words (only the simple ones). */
function argumentList(args: Record<string, unknown>): [string, string][] {
  const rows: [string, string][] = [];
  for (const [key, value] of Object.entries(args)) {
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "object" && !Array.isArray(value)) continue;
    const shown = Array.isArray(value) ? value.join(", ") : String(value);
    if (!shown) continue;
    rows.push([key.replace(/_/g, " "), shown]);
  }
  return rows.slice(0, 8);
}

/**
 * A write the plan wants to make (create an enquiry, draft a quote), held until someone approves it. Focus
 * moves here when it appears, so a keyboard user lands on the decision.
 */
export function ConfirmActionCard({
  pending,
  onDecide,
  deciding,
  error,
}: {
  pending: PendingConfirm;
  onDecide: (approve: boolean) => void;
  /** The decision being sent, if any. */
  deciding: "approve" | "decline" | null;
  error: string | null;
}) {
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);
  const { title, icon: Icon } = TOOL[pending.tool] ?? { title: "Approve action", icon: ShieldQuestion };
  const rows = argumentList(pending.args);
  const warnings = (pending.warnings ?? []).filter((warning) => typeof warning === "string" && warning.trim() !== "");

  useEffect(() => {
    ref.current?.focus();
  }, [pending.call_id]);

  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-labelledby={titleId}
      data-confirm=""
      className="card warn tm-enter p-0 focus:outline-2 focus:outline-offset-2 focus:outline-primary"
    >
      <div className="flex items-start gap-3 p-4">
        <span aria-hidden="true" className="tm-tint grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border text-warn">
          <ShieldQuestion size={17} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="hud text-warn">Needs your approval</p>
          <h3 id={titleId} className="mt-0.5 flex items-center gap-2 text-sm font-semibold text-ink">
            <Icon size={14} aria-hidden="true" className="text-dim" />
            {title}
          </h3>
          <p className="mt-1.5 text-[13px] leading-5 text-ink">{pending.action}</p>
          {rows.length > 0 && (
            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs leading-4">
              {rows.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="capitalize text-faint">{label}</dt>
                  <dd className="min-w-0 truncate font-mono text-dim">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          {warnings.length > 0 && (
            <div className="mt-3 rounded-[12px] border border-warn/40 px-3 py-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-warn">
                <TriangleAlert size={13} aria-hidden="true" className="shrink-0" />
                Check before approving
              </p>
              <ul aria-label="Cautions" className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-xs leading-4 text-ink">
                {warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-3 text-xs leading-4 text-dim">Nothing is saved until you approve. Nothing is booked or paid for.</p>
        </div>
      </div>
      {error && (
        <p role="alert" className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-[13px] text-danger">
          <CircleAlert size={14} aria-hidden="true" className="shrink-0" />
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
        <Button variant="secondary" size="sm" onClick={() => onDecide(false)} loading={deciding === "decline"} disabled={deciding !== null}>
          Decline
        </Button>
        <Button size="sm" onClick={() => onDecide(true)} loading={deciding === "approve"} disabled={deciding !== null}>
          Approve
        </Button>
      </div>
    </section>
  );
}
