import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowRight, ArrowUpRight, TrendingUp } from "lucide-react";
import { marketPulseQueryOptions, type MarketPulseRoute, type Provenance } from "../../api/dashboard";
import { formatNumber } from "../../lib/format";
import { formatMoney } from "../../lib/money";
import { Badge, type BadgeTone } from "../../ui/Badge";
import { Sparkline, type SparklineTone } from "../../ui/charts";
import { DataTable, type DataTableColumn } from "../../ui/DataTable";
import { EmptyState } from "../../ui/EmptyState";
import { Panel } from "../../ui/Panel";
import { cn } from "../../ui/cn";
import { formatChange, routeLabel } from "./format";
import { ErrorPanel } from "./PanelError";
import { FooterLink, LoadingPanel } from "./panelParts";

const TITLE = "Market pulse";
const DESCRIPTION = "Median fare per traveller this week vs the previous four weeks";

/** Where the fares behind a trend came from, in the same tones as offer provenance. Sandbox fares are test data. */
const PROVENANCE: Record<Provenance, { tone: BadgeTone; label: string }> = {
  LIVE: { tone: "ok", label: "Live" },
  SANDBOX: { tone: "warn", label: "Sandbox" },
  MIXED: { tone: "neutral", label: "Mixed" },
};

type Move = { label: string; text: string; tone: SparklineTone; icon: typeof ArrowRight };

/** Moves under 2 % either way read as steady. Falling fares are good news for the traveller. */
function moveOf(change: number): Move {
  if (change >= 2) return { label: "Rising", text: "text-warn", tone: "warn", icon: ArrowUpRight };
  if (change <= -2) return { label: "Falling", text: "text-ok", tone: "ok", icon: ArrowDownRight };
  return { label: "Steady", text: "text-dim", tone: "primary", icon: ArrowRight };
}

function ChangeChip({ change }: { change: number }) {
  const finite = Number.isFinite(change);
  const move = moveOf(finite ? change : 0);
  const Icon = move.icon;
  return (
    <span
      className={cn(
        "tm-tint inline-flex h-5 items-center gap-0.5 rounded-[4px] border px-1.5 font-mono text-[11px] font-medium tabular-nums",
        move.text,
      )}
    >
      <Icon size={12} strokeWidth={2} aria-hidden="true" />
      {formatChange(change)}
      <span className="sr-only">, {move.label.toLowerCase()} vs the previous four weeks</span>
    </span>
  );
}

function ProvenancePill({ provenance }: { provenance: Provenance }) {
  const { tone, label } = PROVENANCE[provenance] ?? PROVENANCE.MIXED;
  return (
    <Badge tone={tone}>
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full bg-current", provenance === "LIVE" && "tm-live")} />
      {label}
    </Badge>
  );
}

const weeklyOf = (route: MarketPulseRoute) =>
  route.weekly.filter((v): v is number => typeof v === "number" && Number.isFinite(v));

export function MarketPulsePanel({ className }: { className?: string }) {
  const pulse = useQuery(marketPulseQueryOptions);

  if (pulse.isPending) return <LoadingPanel title={TITLE} description={DESCRIPTION} className={className} />;
  if (pulse.isError) {
    return (
      <ErrorPanel
        title={TITLE}
        description={DESCRIPTION}
        error={pulse.error}
        onRetry={() => void pulse.refetch()}
        retrying={pulse.isFetching}
        className={className}
      />
    );
  }

  const { routes, currency } = pulse.data;
  const columns: DataTableColumn<MarketPulseRoute>[] = [
    {
      key: "route",
      header: "Route",
      className: "pl-4",
      sortValue: (row) => routeLabel(row.origin, row.destination),
      cell: (row) => (
        <span className="flex flex-col">
          <span className="whitespace-nowrap font-mono text-ink">{routeLabel(row.origin, row.destination)}</span>
          <span className="whitespace-nowrap text-[11px] leading-4 text-faint">{formatNumber(row.samples)} fares</span>
        </span>
      ),
    },
    {
      key: "fare",
      header: "Fare / traveller",
      align: "right",
      sortValue: (row) => row.current_minor,
      cell: (row) => <span className="whitespace-nowrap">{formatMoney({ amount_minor: row.current_minor, currency })}</span>,
    },
    {
      key: "change",
      header: "Change",
      align: "right",
      sortValue: (row) => row.change_pct,
      cell: (row) => <ChangeChip change={row.change_pct} />,
    },
    {
      key: "trend",
      header: "8 weeks",
      className: "w-24 min-w-24",
      cell: (row) => {
        const weekly = weeklyOf(row);
        return weekly.length > 1 ? (
          <Sparkline
            values={weekly}
            label={`${routeLabel(row.origin, row.destination)} weekly median fare`}
            tone={moveOf(row.change_pct).tone}
            height={24}
          />
        ) : (
          <span className="text-[11px] text-faint">1 week</span>
        );
      },
    },
    {
      key: "source",
      header: "Source",
      className: "pr-4",
      cell: (row) => <ProvenancePill provenance={row.provenance} />,
    },
  ];

  return (
    <Panel
      title={TITLE}
      description={DESCRIPTION}
      flush
      className={cn("flex flex-col", className)}
      footer={routes.length > 0 && <FooterLink to="/app/fares">Open fare search</FooterLink>}
    >
      <DataTable
        caption="Routes with the biggest fare moves"
        columns={columns}
        rows={routes}
        getRowId={(row) => `${row.origin}-${row.destination}`}
        className="border-t border-line"
        emptyState={
          <EmptyState
            icon={TrendingUp}
            title="No fare trends yet"
            description="Search fares on your routes; trends appear after two weeks of searches."
            action={{ label: "Search fares", to: "/app/fares" }}
          />
        }
      />
    </Panel>
  );
}
