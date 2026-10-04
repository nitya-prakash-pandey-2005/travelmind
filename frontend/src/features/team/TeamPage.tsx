import { useQuery } from "@tanstack/react-query";
import { MailPlus, UserPlus, Users } from "lucide-react";
import { teamStatsQueryOptions, type TeamStats } from "../../api/dashboard";
import { useMemo, useState } from "react";
import { asApiError } from "../../api/client";
import { invitationsQueryOptions, teamQueryOptions } from "../../api/queries";
import type { Invitation, Role, TeamMember } from "../../api/types";
import { useCurrentUser } from "../../auth/useCurrentUser";
import { formatDate, formatNumber, formatRelativeTime } from "../../lib/format";
import { formatMoneyCompact, formatWholeMoney } from "../../lib/money";
import { Avatar } from "../../kit";
import { Badge, type BadgeTone } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { KpiStrip, KpiTile } from "../../ui/charts";
import { cn } from "../../ui/cn";
import { DataTable, type DataTableColumn } from "../../ui/DataTable";
import { EmptyState } from "../../ui/EmptyState";
import { FormError } from "../../ui/FormError";
import { PageHeader } from "../../ui/PageHeader";
import { Panel } from "../../ui/Panel";
import { TABLE_INSET } from "../quotes/kitClasses";
import { InviteDialog } from "./InviteDialog";
import { RolesPanel } from "./RolesPanel";

const ROLE_TONE: Record<Role, BadgeTone> = { owner: "primary", admin: "info", agent: "neutral" };
const ROLE_ORDER: Record<Role, number> = { owner: 0, admin: 1, agent: 2 };

/** Each member's figures for the last 30 days: loaded, still loading, or unavailable. */
type Stats = { byId: Map<string, TeamStats>; pending: boolean; failed: boolean };

type SortKey = "role" | "name" | "enquiries" | "quotes" | "won";

/** How the members list can be ordered: names A to Z, roles owner first, figures highest first. */
const SORTS: { key: SortKey; label: string }[] = [
  { key: "role", label: "Role" },
  { key: "name", label: "Name" },
  { key: "enquiries", label: "Enquiries" },
  { key: "quotes", label: "Quotes sent" },
  { key: "won", label: "Won value" },
];

const FIGURE: Record<Exclude<SortKey, "role" | "name">, (s: TeamStats) => number> = {
  enquiries: (s) => s.enquiries,
  quotes: (s) => s.quotes_sent,
  won: (s) => s.won_value_minor,
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function sortMembers(members: readonly TeamMember[], key: SortKey, stats: Stats): TeamMember[] {
  const byName = (a: TeamMember, b: TeamMember) => collator.compare(a.full_name, b.full_name);
  if (key === "name") return [...members].sort(byName);
  if (key === "role") return [...members].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || byName(a, b));
  const pick = FIGURE[key];
  const value = (m: TeamMember) => {
    const row = stats.byId.get(m.id);
    return row ? pick(row) : -1;
  };
  return [...members].sort((a, b) => value(b) - value(a) || byName(a, b));
}

/** One of a member's 30-day figures: the value (or "…" while loading, "—" when unavailable) over its label. */
function MemberFigure({ label, value, stats }: { label: string; value: string | null; stats: Stats }) {
  return (
    <span className="flex min-w-0 flex-col items-end">
      <span className={cn("tm-num text-[13px] font-semibold", value && value !== "—" && value !== "0" ? "text-ink" : "text-faint")}>
        {value ?? (stats.pending ? "…" : "—")}
      </span>
      <span className="whitespace-nowrap text-[11px] leading-4 text-dim">{label}</span>
    </span>
  );
}

/** The members as the kit's list: avatar, name and email, role badge, then their figures for the last 30 days. */
function MemberList({ members, myId, stats, currency }: { members: readonly TeamMember[]; myId: string; stats: Stats; currency: string }) {
  return (
    <ul aria-label="Team members" className="list px-2 pb-1">
      {members.map((m) => {
        const row = stats.byId.get(m.id);
        return (
          <li key={m.id} className="li flex-wrap gap-x-3 gap-y-2 px-2">
            <Avatar name={m.full_name} size="sm" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[13.5px] font-semibold text-ink">{m.full_name}</span>
                {m.id === myId && <Badge tone="ok">You</Badge>}
              </span>
              <span className="truncate text-xs text-dim">{m.email}</span>
            </span>
            <Badge tone={ROLE_TONE[m.role]}>{m.role}</Badge>
            <span className="grid w-full grid-cols-3 gap-3 pl-[42px] sm:w-auto sm:min-w-[15rem] sm:pl-2">
              <MemberFigure label="Enquiries" value={row ? formatNumber(row.enquiries) : null} stats={stats} />
              <MemberFigure label="Quotes sent" value={row ? formatNumber(row.quotes_sent) : null} stats={stats} />
              <MemberFigure
                label="Won value"
                value={row ? (row.won_value_minor > 0 ? formatWholeMoney(row.won_value_minor, currency) : "—") : null}
                stats={stats}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const INVITATION_COLUMNS: DataTableColumn<Invitation>[] = [
  { key: "email", header: "Email", sortValue: (i) => i.email, cell: (i) => <span className="text-ink">{i.email}</span> },
  { key: "role", header: "Role", cell: (i) => <Badge tone={ROLE_TONE[i.role]}>{i.role}</Badge> },
  {
    key: "sent",
    header: "Sent",
    sortValue: (i) => i.created_at,
    cell: (i) => <span className="text-dim">{formatRelativeTime(i.created_at)}</span>,
  },
  {
    key: "expires",
    header: "Expires",
    sortValue: (i) => i.expires_at,
    cell: (i) => <span className="tm-num text-dim">{formatDate(i.expires_at)}</span>,
  },
];

/** Team totals for the last 30 days, from the same figures as the members table. */
function TeamTotals({ members, stats, currency }: { members: TeamMember[] | undefined; stats: Stats; currency: string }) {
  const rows = [...stats.byId.values()];
  const sum = (pick: (s: TeamStats) => number) => rows.reduce((total, s) => total + pick(s), 0);
  const managers = members?.filter((m) => m.role !== "agent").length ?? 0;
  const figure = (value: string) => (stats.failed ? "—" : value);
  const hint = stats.failed ? "Unavailable right now" : "Last 30 days";
  return (
    <KpiStrip label="Team totals" columns={4}>
      <KpiTile
        label="Members"
        value={members ? formatNumber(members.length) : ""}
        hint={`${managers} owner${managers === 1 ? "" : "s"} or admin${managers === 1 ? "" : "s"}`}
        loading={!members}
      />
      <KpiTile label="Enquiries" value={figure(formatNumber(sum((s) => s.enquiries)))} hint={hint} loading={stats.pending} />
      <KpiTile label="Quotes sent" value={figure(formatNumber(sum((s) => s.quotes_sent)))} hint={hint} loading={stats.pending} />
      <KpiTile
        label="Won value"
        value={figure(formatMoneyCompact({ amount_minor: sum((s) => s.won_value_minor), currency }))}
        hint={hint}
        loading={stats.pending}
      />
    </KpiStrip>
  );
}

/** Invitations waiting to be accepted. Only managers load them (agents can't list invitations). */
function PendingInvitations() {
  const pending = useQuery(invitationsQueryOptions);
  return (
    <Panel title="Pending invitations" description="Links that haven't been used yet" flush>
      {pending.isError ? (
        <div className="px-[18px] pb-[18px]">
          <FormError error={asApiError(pending.error)} />
        </div>
      ) : (
        <DataTable
          caption="Pending invitations"
          className={TABLE_INSET}
          columns={INVITATION_COLUMNS}
          rows={pending.data ?? []}
          getRowId={(i) => i.id}
          loading={pending.isPending}
          emptyState={
            <EmptyState
              icon={MailPlus}
              title="No pending invitations."
              description="Invite links you create appear here until they're used or expire."
            />
          }
        />
      )}
    </Panel>
  );
}

export function TeamPage() {
  const me = useCurrentUser();
  const team = useQuery(teamQueryOptions);
  const teamStats = useQuery(teamStatsQueryOptions("30d"));
  const [inviting, setInviting] = useState(false);
  const [sort, setSort] = useState<SortKey>("role");
  const statsById = useMemo(() => new Map((teamStats.data?.members ?? []).map((s) => [s.user.id, s])), [teamStats.data]);
  if (!me) return null;
  const isManager = me.user.role === "owner" || me.user.role === "admin";
  const canInvite = isManager && !me.agency.is_demo;
  const count = team.data?.length;
  const stats: Stats = {
    byId: statsById,
    pending: teamStats.isPending,
    failed: teamStats.isError && !teamStats.data,
  };

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Workspace", to: "/app" }, { label: "Team" }]}
        title="Team"
        description={`Everyone with access to ${me.agency.name}.`}
        meta={count !== undefined && <Badge>{`${count} member${count === 1 ? "" : "s"}`}</Badge>}
        actions={
          canInvite && (
            <Button onClick={() => setInviting(true)}>
              <UserPlus size={15} aria-hidden="true" />
              Invite teammate
            </Button>
          )
        }
      />
      {/* The kit's list + detail: totals, members and invitations in span-8, roles and permissions in span-4. */}
      <div className="grid g-12 items-start">
        <div className="span-8 flex min-w-0 flex-col gap-4">
          <TeamTotals members={team.data} stats={stats} currency={me.agency.currency} />
          <Panel
            title="Members"
            description="New enquiries they hold, quotes they sent and value won, last 30 days"
            footer={
              stats.failed ? <span className="text-xs text-dim">Performance figures are unavailable right now.</span> : undefined
            }
            flush
          >
            {team.isPending && (
              <span role="status" className="sr-only">
                Loading members…
              </span>
            )}
            {team.error ? (
              <div className="px-[18px] pb-[18px]">
                <FormError error={asApiError(team.error)} />
              </div>
            ) : team.isPending ? (
              <div aria-hidden="true" className="flex flex-col gap-3 px-[18px] pb-[18px]">
                {[0, 1, 2].map((index) => (
                  <div key={index} className="flex items-center gap-3">
                    <span className="tm-shimmer h-[30px] w-[30px] rounded-[9px]" />
                    <span className="tm-shimmer h-3.5 flex-1 rounded-[8px]" />
                  </div>
                ))}
              </div>
            ) : (team.data ?? []).length === 0 ? (
              <EmptyState icon={Users} title="No members yet" />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-[18px] pb-2">
                  <span className="hud">Sort by</span>
                  <div role="group" aria-label="Sort members" className="seg">
                    {SORTS.map(({ key, label }) => (
                      <button key={key} type="button" aria-pressed={sort === key} className={cn("px-2.5! py-1.5!", sort === key && "on")} onClick={() => setSort(key)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <MemberList members={sortMembers(team.data ?? [], sort, stats)} myId={me.user.id} stats={stats} currency={me.agency.currency} />
              </>
            )}
          </Panel>

          {canInvite ? (
            <PendingInvitations />
          ) : (
            <p className="card text-[13px] leading-5 text-dim">
              {me.agency.is_demo
                ? "Demo workspaces can't invite people. Create your own workspace to add teammates."
                : "Need another seat? Ask an agency owner or admin to invite them."}
            </p>
          )}
        </div>
        <RolesPanel role={me.user.role} className="span-4" />
      </div>
      {inviting && <InviteDialog agencyName={me.agency.name} onClose={() => setInviting(false)} />}
    </>
  );
}
