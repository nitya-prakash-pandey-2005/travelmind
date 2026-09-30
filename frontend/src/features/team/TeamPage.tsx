import { useQuery } from "@tanstack/react-query";
import { MailPlus, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { asApiError } from "../../api/client";
import { invitationsQueryOptions, teamQueryOptions } from "../../api/queries";
import type { Invitation, Role, TeamMember } from "../../api/types";
import { useCurrentUser } from "../../auth/useCurrentUser";
import { formatDate, formatRelativeTime } from "../../lib/format";
import { Avatar } from "../../ui/Avatar";
import { Badge, type BadgeTone } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { DataTable, type DataTableColumn } from "../../ui/DataTable";
import { EmptyState } from "../../ui/EmptyState";
import { FormError } from "../../ui/FormError";
import { PageHeader } from "../../ui/PageHeader";
import { Panel } from "../../ui/Panel";
import { InviteDialog } from "./InviteDialog";

const ROLE_TONE: Record<Role, BadgeTone> = { owner: "primary", admin: "info", agent: "neutral" };
const ROLE_ORDER: Record<Role, number> = { owner: 0, admin: 1, agent: 2 };

function memberColumns(myId: string): DataTableColumn<TeamMember>[] {
  return [
    {
      key: "name",
      header: "Name",
      sortValue: (m) => m.full_name,
      cell: (m) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Avatar name={m.full_name} size="sm" />
          <span className="truncate font-medium text-ink">{m.full_name}</span>
          {m.id === myId && <Badge tone="ok">You</Badge>}
        </span>
      ),
    },
    { key: "email", header: "Email", sortValue: (m) => m.email, cell: (m) => <span className="text-dim">{m.email}</span> },
    {
      key: "role",
      header: "Role",
      sortValue: (m) => ROLE_ORDER[m.role],
      cell: (m) => <Badge tone={ROLE_TONE[m.role]}>{m.role}</Badge>,
    },
  ];
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

/** Invitations waiting to be accepted. Only managers load them (agents can't list invitations). */
function PendingInvitations() {
  const pending = useQuery(invitationsQueryOptions);
  return (
    <Panel title="Pending invitations" description="Links that haven't been used yet" flush>
      {pending.isError ? (
        <div className="px-4 pb-4">
          <FormError error={asApiError(pending.error)} />
        </div>
      ) : (
        <DataTable
          caption="Pending invitations"
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
  const [inviting, setInviting] = useState(false);
  if (!me) return null;
  const isManager = me.user.role === "owner" || me.user.role === "admin";
  const canInvite = isManager && !me.agency.is_demo;
  const count = team.data?.length;

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
      <div className="flex flex-col gap-4">
        <Panel title="Members" flush>
          {team.isPending && (
            <span role="status" className="sr-only">
              Loading members…
            </span>
          )}
          {team.error ? (
            <div className="px-4 pb-4">
              <FormError error={asApiError(team.error)} />
            </div>
          ) : (
            <DataTable
              caption="Team members"
              columns={memberColumns(me.user.id)}
              rows={team.data ?? []}
              getRowId={(m) => m.id}
              loading={team.isPending}
              emptyState={<EmptyState icon={Users} title="No members yet" />}
            />
          )}
        </Panel>

        {canInvite ? (
          <PendingInvitations />
        ) : (
          <p className="rounded-lg border border-line bg-surface px-4 py-3 text-[13px] leading-5 text-dim">
            {me.agency.is_demo
              ? "Demo workspaces can't invite people. Create your own workspace to add teammates."
              : "Need another seat? Ask an agency owner or admin to invite them."}
          </p>
        )}
      </div>
      {inviting && <InviteDialog agencyName={me.agency.name} onClose={() => setInviting(false)} />}
    </>
  );
}
