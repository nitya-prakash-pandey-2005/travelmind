import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { invitationsQueryOptions, teamQueryOptions } from "../../api/queries";
import type { Me } from "../../api/types";
import { Panel } from "../../ui/Panel";
import { Readout } from "../../ui/Readout";

export function AgencyPanel({ me }: { me: Me }) {
  const isManager = me.user.role === "owner" || me.user.role === "admin";
  const team = useQuery(teamQueryOptions);
  const invitations = useQuery({ ...invitationsQueryOptions, enabled: isManager });
  return (
    <Panel eyebrow="Agency status" title={me.agency.name}>
      <dl className="grid grid-cols-2 gap-4">
        <Readout label="Crew aboard" value={team.data ? String(team.data.length) : "—"} />
        {isManager && (
          <Readout label="Pending invites" value={invitations.data ? String(invitations.data.length) : "—"} />
        )}
      </dl>
      <Link to="/team" className="mt-4 inline-block text-sm text-primary hover:underline">
        Open crew roster
      </Link>
    </Panel>
  );
}
