import { Link, useRouterState } from "@tanstack/react-router";
import { Ellipsis, FileText, LayoutDashboard, SquareKanban, Waypoints, type LucideIcon } from "lucide-react";
import { useState } from "react";
import type { Me } from "../api/types";
import { Sheet } from "../kit/ui";
import { initials } from "../ui/Avatar";
import { cn } from "../ui/cn";
import { HelpMenu } from "./HelpMenu";
import { isNavActive, NAV_GROUPS, type NavPath } from "./Sidebar";

type Tab = { to: NavPath; label: string; icon: LucideIcon; also?: string[] };

/** The four primary destinations on phones; everything else is in the More sheet. */
export const PHONE_TABS: readonly Tab[] = [
  { to: "/app", label: "Command", icon: LayoutDashboard },
  { to: "/app/pipeline", label: "Pipeline", icon: SquareKanban, also: ["/app/enquiries/"] },
  { to: "/app/agent", label: "Agent", icon: Waypoints },
  { to: "/app/quotes", label: "Quotes", icon: FileText },
];

const TAB_PATHS = new Set<string>(PHONE_TABS.map((tab) => tab.to));

/** Every sidebar destination that has no tab of its own, still in its group. */
export const MORE_GROUPS = NAV_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => !TAB_PATHS.has(item.to)) })).filter(
  (group) => group.items.length > 0,
);

/**
 * Phones (900 px and below): the kit's bottom tab bar with Command, Pipeline, Agent, Quotes and More. More opens a
 * kit Sheet (a bottom sheet on phones) listing every other destination, with the workspace and help. It sits in the
 * shell's frame below the scrolling content, so it never covers the page.
 */
export function BottomTabs({ me }: { me: Me }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const onMorePage = MORE_GROUPS.some((group) => group.items.some((item) => isNavActive(item, pathname)));
  const { agency } = me;

  return (
    <>
      <nav aria-label="Tabs" className="bottomnav">
        {PHONE_TABS.map(({ to, label, icon: Icon, also }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === "/app" }}
            {...(also?.some((prefix) => pathname.startsWith(prefix)) ? { "data-status": "active", "aria-current": "page" as const } : {})}
          >
            <Icon size={21} strokeWidth={1.75} aria-hidden="true" />
            {label}
          </Link>
        ))}
        <button type="button" aria-haspopup="dialog" aria-expanded={moreOpen} className={cn(onMorePage && "on")} onClick={() => setMoreOpen(true)}>
          <Ellipsis size={21} strokeWidth={1.75} aria-hidden="true" />
          More
        </button>
      </nav>
      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <div className="flex flex-col gap-5">
          <div className="flex min-w-0 items-center gap-3 rounded-[14px] border border-line bg-card-2 px-3 py-2.5">
            <span
              aria-hidden="true"
              className="tm-brand-mark grid h-8 w-8 shrink-0 place-items-center rounded-[9px] text-[11px] font-semibold tracking-[0.02em] text-ink"
            >
              {initials(agency.name)}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{agency.name}</span>
            {agency.is_demo && (
              <span className="badge t-amber shrink-0 font-mono text-[10px] uppercase tracking-[0.1em]">Demo</span>
            )}
            <HelpMenu />
          </div>
          {MORE_GROUPS.map((group) => (
            <section key={group.label} aria-label={group.label} className="flex flex-col gap-1">
              <h3 className="hud px-1">{group.label}</h3>
              <ul className="list">
                {group.items.map(({ to, label, icon: Icon }) => (
                  <li key={to} className="contents">
                    <Link
                      to={to}
                      onClick={() => setMoreOpen(false)}
                      className="li min-h-11 text-sm font-medium text-ink data-[status=active]:bg-card-2 data-[status=active]:text-primary"
                    >
                      <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-card-2 text-dim">
                        <Icon size={16} strokeWidth={1.75} />
                      </span>
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Sheet>
    </>
  );
}
