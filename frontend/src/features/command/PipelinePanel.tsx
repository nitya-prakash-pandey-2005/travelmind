import { useQuery } from "@tanstack/react-query";
import { GitBranch } from "lucide-react";
import { pipelineQueryOptions, type PipelineStage } from "../../api/dashboard";
import { formatNumber } from "../../lib/format";
import { formatMoneyCompact } from "../../lib/money";
import { Funnel } from "../../ui/charts";
import { EmptyState } from "../../ui/EmptyState";
import { Panel } from "../../ui/Panel";
import { PanelSkeleton } from "../../ui/Skeleton";
import { STATUS_PILL, StatusPill } from "../../ui/StatusPill";
import { ErrorPanel } from "./PanelError";

const TITLE = "Pipeline";
const EYEBROW = "Enquiries by stage";
const FUNNEL_STAGES = ["new", "quoting", "quoted", "won"] as const;

export function PipelinePanel({ onNewEnquiry, className }: { onNewEnquiry: () => void; className?: string }) {
  const pipeline = useQuery(pipelineQueryOptions);

  if (pipeline.isPending) return <PanelSkeleton title={TITLE} eyebrow={EYEBROW} className={className} />;
  if (pipeline.isError) {
    return (
      <ErrorPanel
        title={TITLE}
        eyebrow={EYEBROW}
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
  const count = (status: string) => byStatus.get(status)?.count ?? 0;
  const open = count("new") + count("quoting") + count("quoted");
  const lost = byStatus.get("lost");
  const empty = stages.every((stage) => stage.count === 0);

  return (
    <Panel
      variant="glass"
      title={TITLE}
      eyebrow={EYEBROW}
      className={className}
      actions={
        !empty && (
          <span className="font-mono text-xs tabular-nums text-dim">
            <span className="text-ink">{formatNumber(open)}</span> open
          </span>
        )
      }
    >
      {empty ? (
        <EmptyState
          icon={GitBranch}
          title="No enquiries yet"
          description="Every trip request moves through new, quoting, quoted and won here."
          action={{ label: "Create an enquiry", onClick: onNewEnquiry }}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <Funnel
            label="Pipeline by stage"
            valueFormat={money}
            stages={FUNNEL_STAGES.map((status) => ({
              label: STATUS_PILL[status].label,
              count: count(status),
              value: byStatus.get(status)?.value_minor ?? 0,
            }))}
          />
          {lost && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-3 text-sm text-dim">
              <StatusPill status="lost" />
              <span className="font-mono tabular-nums">{formatNumber(lost.count)}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{money(lost.value_minor)}</span>
              <span>closed without a booking</span>
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
