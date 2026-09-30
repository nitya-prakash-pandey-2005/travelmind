import { useQuery } from "@tanstack/react-query";
import { GitBranch } from "lucide-react";
import { pipelineQueryOptions, type PipelineStage, type PipelineStatus } from "../../api/dashboard";
import { formatNumber } from "../../lib/format";
import { formatMoneyCompact } from "../../lib/money";
import { percent, useChartAnimation } from "../../ui/charts/shared";
import { EmptyState } from "../../ui/EmptyState";
import { Panel } from "../../ui/Panel";
import { STATUS_PILL } from "../../ui/StatusPill";
import { ErrorPanel } from "./PanelError";
import { FIGURE, LoadingPanel } from "./panelParts";

const TITLE = "Pipeline";
const DESCRIPTION = "Open enquiries by stage, with quoted value";
/** The stages an enquiry moves through on its way to a booking, in order. */
const STAGES = ["new", "quoting", "quoted", "won"] as const;

const plural = (count: number, one: string, many: string) => `${formatNumber(count)} ${count === 1 ? one : many}`;

/** Share of the previous stage that reached this one, "—" without a base. */
function conversion(count: number, previous: number | undefined): string | null {
  if (previous === undefined) return null;
  return previous > 0 ? `${Math.round((count / previous) * 100)}%` : "—";
}

type Row = { status: PipelineStatus; count: number; value: number };

function StageRow({ row, top, previous, money, index }: { row: Row; top: number; previous?: number; money: (minor: number) => string; index: number }) {
  const animate = useChartAnimation();
  const label = STATUS_PILL[row.status].label;
  const step = conversion(row.count, previous);
  const width = percent(row.count, top);
  return (
    <li className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-x-3 py-1.5">
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] text-ink">{label}</span>
        {step !== null && (
          <span className="font-mono text-[11px] tabular-nums text-faint">
            {step}
            <span className="sr-only"> of the previous stage</span>
          </span>
        )}
      </span>
      {/* A baseline-anchored bar per stage, one hue: the length is the count. */}
      <span aria-hidden="true" className="relative block h-2 overflow-hidden rounded-[2px] bg-chart-grid">
        {width !== "0%" && (
          <span
            data-stage-bar=""
            className={animate ? "tm-grow-x absolute inset-y-0 left-0 rounded-r-[2px] bg-chart-1" : "absolute inset-y-0 left-0 rounded-r-[2px] bg-chart-1"}
            style={{ width, animationDelay: animate ? `${index * 50}ms` : undefined }}
          />
        )}
      </span>
      <span className="flex min-w-[5.5rem] items-baseline justify-end gap-2">
        <span className={FIGURE}>
          {formatNumber(row.count)}
          <span className="sr-only"> {row.count === 1 ? "enquiry" : "enquiries"},</span>
        </span>
        <span className="w-12 text-right font-mono text-[11px] tabular-nums text-dim">{row.value > 0 ? money(row.value) : "—"}</span>
      </span>
    </li>
  );
}

export function PipelinePanel({ onNewEnquiry, className }: { onNewEnquiry: () => void; className?: string }) {
  const pipeline = useQuery(pipelineQueryOptions);

  if (pipeline.isPending) return <LoadingPanel title={TITLE} description={DESCRIPTION} className={className} />;
  if (pipeline.isError) {
    return (
      <ErrorPanel
        title={TITLE}
        description={DESCRIPTION}
        error={pipeline.error}
        onRetry={() => void pipeline.refetch()}
        retrying={pipeline.isFetching}
        className={className}
      />
    );
  }

  const { currency, stages } = pipeline.data;
  const byStatus = new Map<string, PipelineStage>(stages.map((stage) => [stage.status, stage]));
  const money = (minor: number) => formatMoneyCompact({ amount_minor: minor, currency });
  const rows: Row[] = STAGES.map((status) => ({
    status,
    count: byStatus.get(status)?.count ?? 0,
    value: byStatus.get(status)?.value_minor ?? 0,
  }));
  const open = rows.filter((r) => r.status !== "won").reduce((sum, r) => sum + r.count, 0);
  const openValue = rows.filter((r) => r.status !== "won").reduce((sum, r) => sum + r.value, 0);
  const top = Math.max(0, ...rows.map((r) => r.count));
  const lost = byStatus.get("lost");
  const empty = stages.every((stage) => stage.count === 0);

  return (
    <Panel
      title={TITLE}
      description={DESCRIPTION}
      className={className}
      actions={
        !empty && (
          <p className="text-right font-mono text-[11px] tabular-nums leading-4 text-dim">
            <span className="text-[13px] text-ink">{formatNumber(open)}</span> open
            {openValue > 0 && <span className="block">{money(openValue)} quoted</span>}
          </p>
        )
      }
    >
      {empty ? (
        <EmptyState
          icon={GitBranch}
          title="No enquiries yet"
          description="Each trip request moves through new, quoting, quoted and won here."
          action={{ label: "Create enquiry", onClick: onNewEnquiry }}
        />
      ) : (
        <>
          <div className="mb-1 grid grid-cols-[5.5rem_minmax(0,1fr)_auto] gap-x-3 border-b border-line pb-1.5">
            <span className="tm-micro">Stage</span>
            <span />
            <span className="tm-micro flex min-w-[5.5rem] justify-end gap-2">
              <span>Count</span>
              <span className="w-12 text-right">Value</span>
            </span>
          </div>
          <ol aria-label="Pipeline by stage">
            {rows.map((row, index) => (
              <StageRow key={row.status} row={row} top={top} previous={rows[index - 1]?.count} money={money} index={index} />
            ))}
          </ol>
          {lost && lost.count > 0 && (
            <p className="mt-2 flex flex-wrap items-baseline gap-x-2 border-t border-line pt-2.5 text-xs text-dim">
              <span className="text-ink">Lost</span>
              <span className="font-mono tabular-nums">{plural(lost.count, "enquiry", "enquiries")}</span>
              {lost.value_minor > 0 && <span className="font-mono tabular-nums">{money(lost.value_minor)}</span>}
              <span>closed without a booking</span>
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
