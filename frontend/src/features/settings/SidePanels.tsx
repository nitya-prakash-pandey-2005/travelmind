import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, EyeOff, History, LineChart, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { teamQueryOptions } from "../../api/queries";
import type { Me, Role } from "../../api/types";
import type { AgencyProfile } from "../../api/workspace";
import { formatDate } from "../../lib/format";
import { formatClock, useClock, zoneAbbreviation } from "../../shell/useClock";
import { daysUntil } from "../../shell/DemoBanner";
import { ThemePanel } from "../../theme/ThemeSwitcher";
import { AvatarStack } from "../../ui/Avatar";
import { Badge } from "../../ui/Badge";
import { Panel } from "../../ui/Panel";
import { Skeleton } from "../../ui/Skeleton";

const ROLE_NAME: Record<Role, string> = { owner: "Owner", admin: "Admin", agent: "Agent" };
const ROLES: readonly Role[] = ["owner", "admin", "agent"];
const LINK = "inline-flex items-center gap-1 rounded-sm text-[13px] font-medium text-primary underline-offset-2 hover:underline";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-baseline gap-3">
      <dt className="tm-micro">{label}</dt>
      <dd className="min-w-0 break-words text-[13px] leading-5 text-ink">{children}</dd>
    </div>
  );
}

function demoLeft(iso: string): string {
  const days = daysUntil(iso);
  if (days === null) return "";
  if (days === 0) return "today";
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}

/** What kind of workspace this is, who is looking at it and the agency's clock. */
export function WorkspacePanel({ profile, me }: { profile: AgencyProfile; me: Me }) {
  const now = useClock(30_000);
  return (
    <Panel title="Workspace" description="This workspace and your access to it">
      <dl className="flex flex-col gap-3">
        <Fact label="Type">
          <span className="inline-flex flex-wrap items-center gap-2">
            {profile.is_demo ? "Demo workspace" : "Agency workspace"}
            {profile.is_demo && <Badge tone="warn">Sample data</Badge>}
          </span>
        </Fact>
        {profile.is_demo && profile.demo_expires_at && (
          <Fact label="Deleted">
            {formatDate(profile.demo_expires_at)} <span className="text-dim">· {demoLeft(profile.demo_expires_at)}</span>
          </Fact>
        )}
        <Fact label="Your role">{ROLE_NAME[me.user.role]}</Fact>
        <Fact label="Signed in as">
          <span title={me.user.email} className="block truncate">
            {me.user.email}
          </span>
        </Fact>
        <Fact label="Agency time">
          <span className="font-mono tabular-nums">
            {formatClock(now, profile.timezone).slice(0, 5)} {zoneAbbreviation(now, profile.timezone, profile.country_code)}
          </span>
        </Fact>
        <Fact label="Workspace ID">
          <span className="break-all font-mono text-[11px] leading-4 text-dim">{profile.id}</span>
        </Fact>
      </dl>
    </Panel>
  );
}

function roleCounts(roles: Role[]): string {
  return ROLES.map((role) => {
    const count = roles.filter((r) => r === role).length;
    return `${count} ${role}${count === 1 ? "" : "s"}`;
  }).join(" · ");
}

/** Headcount by role, with the way to the Team page. */
export function TeamSummaryPanel() {
  const team = useQuery(teamQueryOptions);
  const members = team.data ?? [];
  return (
    <Panel
      title="Team"
      description="People with access to this workspace"
      footer={
        <Link to="/app/team" className={LINK}>
          Manage team
          <ArrowRight size={13} aria-hidden="true" />
        </Link>
      }
    >
      {team.isPending ? (
        <Skeleton lines={2} />
      ) : team.isError ? (
        <p className="text-[13px] text-dim">The team list couldn't be loaded. It's on the Team page.</p>
      ) : (
        <div className="flex items-center gap-3">
          <AvatarStack names={members.map((m) => m.full_name)} max={4} />
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-semibold text-ink">
              {members.length} {members.length === 1 ? "person" : "people"}
            </span>
            <span className="text-xs text-dim">{roleCounts(members.map((m) => m.role))}</span>
          </div>
        </div>
      )}
    </Panel>
  );
}

/** The theme picker, here as well as in the top bar. */
export function AppearancePanel() {
  return (
    <Panel title="Appearance" description="Saved on this device. It doesn't change what clients see." flush>
      <ThemePanel className="border-t border-line" />
    </Panel>
  );
}

const PRIVACY: { icon: typeof Lock; text: string }[] = [
  { icon: Lock, text: "Clients, enquiries and quotes are visible only to people in this workspace." },
  {
    icon: EyeOff,
    text: "Client quote pages show only the version you sent: never supplier references, markups, costs or teammates' details.",
  },
  {
    icon: LineChart,
    text: "Route intel reads fare history shared across workspaces: fares only, never who searched or for which client, with update times rounded to the hour.",
  },
  { icon: History, text: "Changes to these settings are recorded in the workspace's activity." },
];

/** How the workspace's data is handled, as built. */
export function PrivacyPanel() {
  return (
    <Panel title="Data and privacy" description="How this workspace's data is handled">
      <ul className="flex flex-col gap-2.5">
        {PRIVACY.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-start gap-2.5 text-[13px] leading-5 text-dim">
            <Icon size={14} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-faint" />
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
