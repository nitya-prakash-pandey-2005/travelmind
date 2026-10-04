import { Check, Minus, ShieldCheck } from "lucide-react";
import type { Role } from "../../api/types";
import { Badge, type BadgeTone } from "../../ui/Badge";
import { cn } from "../../ui/cn";
import { Panel } from "../../ui/Panel";

/** The same tones as the members list's role badges. */
const ROLE_TONE: Record<Role, BadgeTone> = { owner: "primary", admin: "info", agent: "neutral" };

const ROLES: { role: Role; label: string; about: string }[] = [
  { role: "owner", label: "Owner", about: "Created the workspace. Same rights as an admin." },
  { role: "admin", label: "Admin", about: "Manages people and agency details, and does everything an agent does." },
  { role: "agent", label: "Agent", about: "Works enquiries, quotes, clients and searches." },
];

/**
 * What each role can do today, as the API enforces it: inviting teammates, seeing pending invitations and
 * changing agency details need owner or admin; everything else is open to every member.
 */
const CAPABILITIES: { label: string; managersOnly: boolean }[] = [
  { label: "Search fares and hotels", managersOnly: false },
  { label: "Work enquiries, quotes and clients", managersOnly: false },
  { label: "See the Command Center, team and suppliers", managersOnly: false },
  { label: "Invite teammates as admin or agent", managersOnly: true },
  { label: "See pending invitations", managersOnly: true },
  { label: "Change agency details", managersOnly: true },
];

const allowed = (role: Role, managersOnly: boolean) => !managersOnly || role !== "agent";

function Mark({ yes }: { yes: boolean }) {
  return yes ? (
    <span className="inline-flex justify-center text-ok">
      <Check size={14} strokeWidth={2.25} aria-hidden="true" />
      <span className="sr-only">Allowed</span>
    </span>
  ) : (
    <span className="inline-flex justify-center text-faint">
      <Minus size={14} aria-hidden="true" />
      <span className="sr-only">Not allowed</span>
    </span>
  );
}

/** Roles and permissions: one line per role, then a capability matrix; the viewer's own role is marked. */
export function RolesPanel({ role: mine, className }: { role: Role; className?: string }) {
  return (
    <Panel title="Roles and permissions" description="What each role can do in TravelMind today" icon={ShieldCheck} className={className}>
      <ul aria-label="Roles" className="list">
        {ROLES.map(({ role, label, about }) => (
          <li key={role} className="li flex-col items-start gap-1.5 px-0 py-2.5">
            <span className="flex items-center gap-2">
              <Badge tone={ROLE_TONE[role]}>{label}</Badge>
              {role === mine && <Badge tone="ok">You</Badge>}
            </span>
            <span className="text-xs leading-4 text-dim">{about}</span>
          </li>
        ))}
      </ul>
      <table className="mt-3 w-full border-t border-line text-xs">
        <caption className="sr-only">Permissions by role</caption>
        <thead>
          <tr className="hud">
            <th scope="col" className="py-2 text-left font-medium">
              <span className="sr-only">Capability</span>
            </th>
            {ROLES.map(({ role, label }) => (
              <th key={role} scope="col" className={cn("w-12 py-2 text-center font-medium", role === mine && "text-ink")}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CAPABILITIES.map(({ label, managersOnly }) => (
            <tr key={label} className="border-t border-line">
              <th scope="row" className="py-2 pr-2 text-left font-normal leading-4 text-dim">
                {label}
              </th>
              {ROLES.map(({ role }) => (
                <td key={role} className="py-2 text-center">
                  <Mark yes={allowed(role, managersOnly)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 border-t border-line pt-3 text-xs leading-4 text-faint">
        Nobody is invited as an owner. Supplier keys are set on the server, not by any role.
      </p>
    </Panel>
  );
}
