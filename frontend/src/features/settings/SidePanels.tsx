import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, EyeOff, History, LineChart, Lock, MonitorSmartphone, ShieldCheck, SwatchBook, Users } from "lucide-react";
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { teamQueryOptions } from "../../api/queries";
import type { Me, Role } from "../../api/types";
import type { AgencyProfile } from "../../api/workspace";
import { formatDate } from "../../lib/format";
import { formatClock, useClock, zoneAbbreviation } from "../../shell/useClock";
import { daysUntil } from "../../shell/DemoBanner";
import { themeMeta, THEMES, useThemeChoice, type ThemeMode } from "../../theme";
import { AvatarStack } from "../../ui/Avatar";
import { Badge } from "../../ui/Badge";
import { cn } from "../../ui/cn";
import { Panel } from "../../ui/Panel";
import { SegmentedControl } from "../../ui/SegmentedControl";
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
    <Panel title="Workspace" description="This workspace and your access to it" icon={MonitorSmartphone}>
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
      icon={Users}
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

const MODE_OPTIONS = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
] as const;

/**
 * The theme picker as the kit's theme grid: one swatch card per theme (a radio group: arrow keys move and pick,
 * Home and End jump), then the mode and high-contrast controls. Fixed themes (Clearsky, Contrast) disable both and
 * say why. Picking applies at once and is saved, as in the top bar's switcher.
 */
export function AppearancePanel() {
  const [choice, setChoice] = useThemeChoice();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const noteId = useId();
  const contrastId = useId();
  const meta = themeMeta(choice.theme);
  const fixed = meta.modes !== "toggle";
  const selected = Math.max(
    0,
    THEMES.findIndex((theme) => theme.id === choice.theme),
  );

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number> = {
      ArrowRight: selected + 1,
      ArrowDown: selected + 1,
      ArrowLeft: selected - 1,
      ArrowUp: selected - 1,
      Home: 0,
      End: THEMES.length - 1,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const index = (target + THEMES.length) % THEMES.length;
    const theme = THEMES[index];
    if (!theme) return;
    setChoice({ theme: theme.id });
    refs.current[index]?.focus();
  }

  return (
    <Panel title="Appearance" description="Saved on this device. It doesn't change what clients see." icon={SwatchBook}>
      <div role="radiogroup" aria-label="Theme" onKeyDown={onKeyDown} className="grid g2 keep-2">
        {THEMES.map((theme, index) => {
          const on = index === selected;
          return (
            <button
              key={theme.id}
              ref={(node) => {
                refs.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-describedby={`${noteId}-${theme.id}`}
              tabIndex={on ? 0 : -1}
              onClick={() => setChoice({ theme: theme.id })}
              className={cn("card tight interactive flex min-w-0 flex-col gap-2 text-left", on && "glow")}
            >
              <span aria-hidden="true" className="grid h-10 grid-cols-4 overflow-hidden rounded-[10px] border border-line-strong">
                {theme.swatch.map((colour, stop) => (
                  <span key={stop} style={{ backgroundColor: colour }} />
                ))}
              </span>
              <span className="flex min-w-0 items-center justify-between gap-2">
                <span className={cn("truncate text-[13px] font-semibold", on ? "text-ink" : "text-dim")}>{theme.name}</span>
                {on && <Check size={15} strokeWidth={2.25} aria-hidden="true" className="shrink-0 text-ok" />}
              </span>
              <span id={`${noteId}-${theme.id}`} className="line-clamp-2 text-[11.5px] leading-4 text-faint">
                {theme.tagline}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex flex-col gap-3 border-t border-line pt-3.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-ink">Mode</span>
          <SegmentedControl
            label="Mode"
            options={MODE_OPTIONS}
            value={choice.mode}
            onChange={(mode: ThemeMode) => setChoice({ mode })}
            disabled={fixed}
            describedBy={fixed ? noteId : undefined}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span id={contrastId} className={cn("text-[13px]", fixed ? "text-dim" : "text-ink")}>
            High contrast
          </span>
          {/* The kit's Toggle, as a switch named by its label and described by the fixed-theme note. */}
          <button
            type="button"
            role="switch"
            aria-checked={choice.contrast}
            aria-labelledby={contrastId}
            aria-describedby={fixed ? noteId : undefined}
            disabled={fixed}
            onClick={() => setChoice({ contrast: !choice.contrast })}
            className={cn("toggle", choice.contrast && "on")}
          />
        </div>
        {fixed && (
          <p id={noteId} className="text-xs leading-4 text-dim">
            {meta.name} has a single look, so mode and contrast are set by the theme.
          </p>
        )}
      </div>
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
    <Panel title="Data and privacy" description="How this workspace's data is handled" icon={ShieldCheck}>
      <ul className="list">
        {PRIVACY.map(({ icon: Icon, text }) => (
          <li key={text} className="li items-start gap-3 px-0 py-2.5 text-[13px] leading-5 text-dim">
            <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-card-2 text-dim">
              <Icon size={14} strokeWidth={1.75} />
            </span>
            <span className="pt-0.5">{text}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
