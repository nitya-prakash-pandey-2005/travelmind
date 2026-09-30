import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { teamStatsQueryOptions, type DashboardRange, type TeamStats } from "../../api/dashboard";
import { useCurrentUser } from "../../auth/useCurrentUser";
import { formatNumber } from "../../lib/format";
import { formatMoneyCompact } from "../../lib/money";
import { Avatar } from "../../ui/Avatar";
import { percent } from "../../ui/charts/shared";
import { DataTable, type DataTableColumn } from "../../ui/DataTable";
import { EmptyState } from "../../ui/EmptyState";
import { Panel } from "../../ui/Panel";
import { cn } from "../../ui/cn";
import { ErrorPanel } from "./PanelError";
import { FooterLink, LoadingPanel } from "./panelParts";

const TITLE = "Team performance";
const RANGE_WORDS: Record<DashboardRange, string> = { "7d": "last 7 days", "30d": "last 30 days", "90d": "last 90 days" };

type Ranked = TeamStats & { rank: number };

export function TeamPanel({ range, className }: { range: DashboardRange; className?: string }) {
  const me = useCurrentUser();
  const team = useQuery(teamStatsQueryOptions(range));
  const description = `Ranked by won value, ${RANGE_WORDS[range]}`;

  if (team.isPending) return <LoadingPanel title={TITLE} description={description} rows={3} className={className} />;
  if (team.isError && !team.data) {
    return (
      <ErrorPanel
        title={TITLE}
        description={description}
        error={team.error}
        onRetry={() => void team.refetch()}
        retrying={team.isFetching}
        className={className}
      />
    );
  }

  const members: Ranked[] = team.data.members.map((member, index) => ({ ...member, rank: index + 1 }));
  const currency = me?.agency.currency ?? "INR";
  const money = (minor: number) => formatMoneyCompact({ amount_minor: minor, currency });
  const empty = members.every((m) => m.enquiries === 0 && m.quotes_sent === 0 && m.won_value_minor === 0);
  const topWon = Math.max(0, ...members.map((m) => m.won_value_minor));

  const columns: DataTableColumn<Ranked>[] = [
    {
      key: "rank",
      header: "#",
      className: "w-8 pl-4",
      sortValue: (row) => row.rank,
      cell: (row) => <span className="font-mono tabular-nums text-faint">{row.rank}</span>,
    },
    {
      key: "member",
      header: "Teammate",
      sortValue: (row) => row.user.full_name,
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-2">
          <Avatar name={row.user.full_name} size="sm" />
          <span className="truncate">{row.user.full_name}</span>
          {row.user.id === me?.user.id && <span className="text-[11px] text-faint">You</span>}
        </span>
      ),
    },
    {
      key: "enquiries",
      header: "Enquiries",
      align: "right",
      sortValue: (row) => row.enquiries,
      cell: (row) => formatNumber(row.enquiries),
    },
    {
      key: "quotes",
      header: "Quotes sent",
      align: "right",
      sortValue: (row) => row.quotes_sent,
      cell: (row) => formatNumber(row.quotes_sent),
    },
    {
      key: "won",
      header: "Won",
      align: "right",
      className: "pr-4",
      sortValue: (row) => row.won_value_minor,
      cell: (row) => (
        <span className="flex flex-col items-end gap-1">
          <span className={row.won_value_minor > 0 ? undefined : "text-faint"}>
            {row.won_value_minor > 0 ? money(row.won_value_minor) : "—"}
          </span>
          {/* Share of the top closer's won value, as a hairline under the figure. */}
          <span aria-hidden="true" className="block h-0.5 w-14 overflow-hidden rounded-full bg-chart-grid">
            <span className="block h-full rounded-full bg-chart-1" style={{ width: percent(row.won_value_minor, topWon) }} />
          </span>
        </span>
      ),
    },
  ];

  return (
    <Panel
      title={TITLE}
      description={description}
      busy={team.isPlaceholderData}
      flush
      className={cn("flex flex-col", className)}
      footer={<FooterLink to="/app/team">Manage team</FooterLink>}
    >
      {empty ? (
        <EmptyState
          icon={Users}
          title="No team activity in this range"
          description="Enquiries handled, quotes sent and trips won are ranked here by teammate."
          action={{ label: "Invite teammate", to: "/app/team" }}
        />
      ) : (
        <DataTable
          caption="Won value by teammate"
          columns={columns}
          rows={members}
          getRowId={(row) => row.user.id}
          className="border-t border-line"
          emptyState={null}
        />
      )}
    </Panel>
  );
}
