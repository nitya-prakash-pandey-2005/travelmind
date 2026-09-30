import { DatabaseZap, LockKeyhole, ScrollText, Tags, UsersRound, type LucideIcon } from "lucide-react";

type Control = { icon: LucideIcon; title: string; body: string };

/** Only controls the platform actually enforces today. Keep this list honest when the backend changes. */
const CONTROLS: Control[] = [
  {
    icon: DatabaseZap,
    title: "Each agency's data kept apart",
    body: "Workspace data sits behind PostgreSQL row-level security. Queries only see the signed-in agency's rows, enforced by the database, not by application code alone.",
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
    body: "Live, Cached and Sandbox labels follow a price everywhere it appears, and demo workspaces are marked as demos on every screen.",
  },
];

export function TrustSection() {
  return (
    <section id="security" aria-labelledby="security-title" className="scroll-mt-20 border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-16 lg:py-24">
        <div className="max-w-md">
          <h2 id="security-title" className="text-[28px] font-semibold leading-tight tracking-[-0.015em] text-ink sm:text-[32px]">
            Security and data handling
          </h2>
          <p className="mt-3 text-base leading-7 text-dim">
            Your clients' trips and your margins stay inside your workspace. These controls are enforced by the
            platform, not by policy documents.
          </p>
        </div>
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {CONTROLS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-4 py-5">
              <span
                aria-hidden="true"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line-strong bg-surface text-dim"
              >
                <Icon size={16} strokeWidth={1.75} />
              </span>
              <div>
                <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
                <p className="mt-1 text-sm leading-6 text-dim">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
