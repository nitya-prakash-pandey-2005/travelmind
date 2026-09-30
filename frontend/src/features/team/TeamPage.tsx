import { useQuery } from "@tanstack/react-query";
import { asApiError } from "../../api/client";
import { teamQueryOptions } from "../../api/queries";
import { useCurrentUser } from "../../auth/useCurrentUser";
import { Badge } from "../../ui/Badge";
import { FormError } from "../../ui/FormError";
import { Panel } from "../../ui/Panel";
import { InvitePanel } from "./InvitePanel";

export function TeamPage() {
  const me = useCurrentUser();
  const team = useQuery(teamQueryOptions);
  if (!me) return null;
  const isManager = me.user.role === "owner" || me.user.role === "admin";

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <Panel eyebrow="Crew roster" title={`${me.agency.name} crew`}>
        {team.isPending && <p className="font-mono text-xs uppercase tracking-[0.2em] text-dim">Loading crew…</p>}
        {team.error && <FormError error={asApiError(team.error)} />}
        {team.data && (
          <table aria-label="Crew members" className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line font-mono text-[11px] uppercase tracking-[0.2em] text-dim">
                <th scope="col" className="py-2 font-normal">Name</th>
                <th scope="col" className="py-2 font-normal">Email</th>
                <th scope="col" className="py-2 font-normal">Role</th>
              </tr>
            </thead>
            <tbody>
              {team.data.map((member) => (
                <tr key={member.id} className="border-b border-line/60">
                  <td className="py-2 text-ink">
                    <span className="flex items-center gap-2">
                      {member.full_name}
                      {member.id === me.user.id && <Badge tone="ok">You</Badge>}
                    </span>
                  </td>
                  <td className="py-2 font-mono text-xs text-dim">{member.email}</td>
                  <td className="py-2">
                    <Badge tone={member.role === "agent" ? "neutral" : "primary"}>{member.role}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      {me.agency.is_demo ? (
        <Panel eyebrow="Invitations" title="Invites are off in the demo">
          <p className="text-sm text-dim">Demo workspaces can't invite people. Start your own agency to build a crew.</p>
        </Panel>
      ) : isManager ? (
        <InvitePanel />
      ) : (
        <Panel eyebrow="Invitations" title="Need another seat?">
          <p className="text-sm text-dim">Ask an agency owner or admin to invite them.</p>
        </Panel>
      )}
    </div>
  );
}
