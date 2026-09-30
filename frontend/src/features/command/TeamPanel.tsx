import { useQuery } from "@tanstack/react-query";
import { Trophy, Users } from "lucide-react";
import { teamStatsQueryOptions, type DashboardRange } from "../../api/dashboard";
import { useCurrentUser } from "../../auth/useCurrentUser";
import { formatNumber } from "../../lib/format";
import { formatMoneyCompact } from "../../lib/money";
import { Avatar, AvatarStack } from "../../ui/Avatar";
import { BarList } from "../../ui/charts";
import { EmptyState } from "../../ui/EmptyState";
import { Panel } from "../../ui/Panel";
import { PanelSkeleton } from "../../ui/Skeleton";
import { ErrorPanel } from "./PanelError";

const TITLE = "Team";
const EYEBROW = "Leaderboard · won value";

const plural = (count: number, one: string, many: string) => `${formatNumber(count)} ${count === 1 ? one : many}`;

export function TeamPanel({ range, className }: { range: DashboardRange; className?: string }) {
  const me = useCurrentUser();
  const team = useQuery(teamStatsQueryOptions(range));

  if (team.isPending) return <PanelSkeleton title={TITLE} eyebrow={EYEBROW} className={className} />;
  if (team.isError && !team.data) {
    return (
      <ErrorPanel
        title={TITLE}
        eyebrow={EYEBROW}
        error={team.error}
        onRetry={() => void team.refetch()}
        retrying={team.isFetching}
        className={className}
      />
    );
  }

  const members = team.data.members;
  const currency = me?.agency.currency ?? "INR";
  const money = (minor: number) => formatMoneyCompact({ amount_minor: minor, currency });
  const empty = members.every((m) => m.enquiries === 0 && m.quotes_sent === 0 && m.won_value_minor === 0);
  const leader = members[0];

  return (
    <Panel
      variant="glass"
      title={TITLE}
      eyebrow={EYEBROW}
      busy={team.isPlaceholderData}
      className={className}
      actions={members.length > 1 && <AvatarStack names={members.map((m) => m.user.full_name)} max={4} />}
    >
      {empty ? (
        <EmptyState
          icon={Users}
          title="No team activity in this range"
          description="Enquiries handled, quotes sent and trips won by each teammate rank here."
          action={{ label: "Invite a teammate", to: "/app/team" }}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {leader && leader.won_value_minor > 0 && (
            <div className="tm-tint flex items-center gap-3 rounded-md border px-3 py-2 text-ok">
              <Avatar name={leader.user.full_name} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em]">
                  <Trophy size={12} aria-hidden="true" />
                  Top closer
                </p>
                <p className="truncate text-sm text-ink">{leader.user.full_name}</p>
              </div>
              <span className="font-mono text-lg text-ink">{money(leader.won_value_minor)}</span>
            </div>
          )}
          <BarList
            label="Won value by teammate"
            valueFormat={money}
            items={members.map((m) => ({
              label: m.user.full_name,
              hint: `${plural(m.quotes_sent, "quote", "quotes")} sent · ${plural(m.enquiries, "enquiry", "enquiries")}`,
              value: m.won_value_minor,
            }))}
          />
        </div>
      )}
    </Panel>
  );
}
