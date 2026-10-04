import { DatabaseZap, LockKeyhole, ScrollText, Tags, UsersRound, type LucideIcon } from "lucide-react";
import { cn } from "../../ui/cn";
import { Kicker } from "./Kicker";
import { ANCHOR, CONTAINER, ICON_CHIP, SECTION_LEAD, SECTION_TITLE, SECTION_Y } from "./layout";

type Control = { icon: LucideIcon; title: string; body: string };

/** Only controls the platform actually enforces today. Keep this list honest when the backend changes. */
const CONTROLS: Control[] = [
  {
    icon: DatabaseZap,
    title: "Each agency's data kept apart",
    body: "Workspace tables sit behind PostgreSQL row-level security, so queries only see the signed-in agency's rows.",
  },
  {
    icon: UsersRound,
    title: "Owner, admin and agent roles",
    body: "Owners and admins invite teammates and manage the workspace. Agents work enquiries and searches.",
  },
  {
    icon: ScrollText,
    title: "Audit log",
    body: "Sign-ins, invitations and workspace changes are recorded with who made them, when, and what changed.",
  },
  {
    icon: LockKeyhole,
    title: "Passwords and sessions",
    body: "Passwords are hashed with Argon2. Sessions live in httpOnly cookies that page scripts can't read.",
  },
  {
    icon: Tags,
    title: "Provenance on every price",
    body: "Live, Cached and Sandbox labels follow a price everywhere, and demo workspaces are marked on every screen.",
  },
];

/** The policy exactly as backend/db.tenant_rls_statements writes it, shown for one of the tables it guards. */
const POLICY = [
  { text: "ALTER TABLE enquiries FORCE ROW LEVEL SECURITY;", tone: "text-dim" },
  { text: "", tone: "" },
  { text: "CREATE POLICY tenant_isolation ON enquiries", tone: "text-ink" },
  { text: "  USING (agency_id = NULLIF(", tone: "text-ink" },
  {
    text: "    current_setting('app.agency_id', true), ''",
    tone: "text-primary",
  },
  { text: "  )::uuid);", tone: "text-ink" },
];

function PolicyCard() {
  return (
    <figure className="card flush mt-8 min-w-0">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-chrome px-4 py-2.5">
        <span className="font-display text-[14px] font-semibold text-ink">Tenant isolation policy</span>
        <span className="hud">PostgreSQL</span>
      </div>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[12px] leading-5">
        {POLICY.map((line, index) => (
          <span key={index} className={cn("block", line.tone)}>
            {line.text || " "}
          </span>
        ))}
      </pre>
      <figcaption className="border-t border-line px-4 py-2.5 text-xs text-faint">
        Applied to every workspace table: clients, enquiries, quotes, activity and searches.
      </figcaption>
    </figure>
  );
}

export function TrustSection() {
  return (
    <section id="security" aria-labelledby="security-title" className={ANCHOR}>
      <div className={cn(CONTAINER, SECTION_Y, "grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-16")}>
        <div className="min-w-0">
          <Kicker>Security</Kicker>
          <h2 id="security-title" className={SECTION_TITLE}>
            Security and data handling
          </h2>
          <p className={SECTION_LEAD}>
            Your clients' trips and your margins stay inside your workspace. These controls are enforced by the platform, not by policy
            documents.
          </p>
          <PolicyCard />
        </div>
        <ul className="grid content-start gap-4 sm:grid-cols-2">
          {CONTROLS.map(({ icon: Icon, title, body }, index) => (
            <li key={title} className={cn("card flex flex-col p-5", index === 0 && "glow sm:col-span-2")}>
              <span className="flex items-center gap-3">
                <span aria-hidden="true" className={ICON_CHIP}>
                  <Icon size={16} strokeWidth={1.75} />
                </span>
                <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
              </span>
              <p className="mt-2.5 text-[13px] leading-5 text-dim">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
