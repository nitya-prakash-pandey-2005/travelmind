import { Link, useRouterState } from "@tanstack/react-router";
import type { Me } from "../api/types";
import { CommandPalette } from "../features/palette/CommandPalette";
import { ThemeSwitcher } from "../theme/ThemeSwitcher";
import { initials } from "../ui/Avatar";
import { HelpMenu } from "./HelpMenu";
import { NotificationsBell } from "./NotificationsBell";
import { BrandLogo, isNavActive, NAV_GROUPS } from "./Sidebar";
import { UserMenu } from "./UserMenu";

/** Pages that aren't sidebar items, titled after what they show. */
const DETAIL_TITLES: ReadonlyArray<[prefix: string, title: string, group: string]> = [
  ["/app/enquiries/", "Enquiry", "Pipeline"],
  ["/app/quotes/", "Quote", "Quotes"],
  ["/app/clients/", "Client", "Clients"],
];

/** The phone top bar's title and sub-line for a path: the page, then its section. */
export function pageTitle(pathname: string): { title: string; sub: string } {
  for (const [prefix, title, sub] of DETAIL_TITLES) {
    if (pathname.startsWith(prefix)) return { title, sub };
  }
  for (const group of NAV_GROUPS) {
    const item = group.items.find((candidate) => isNavActive(candidate, pathname));
    if (item) return { title: item.label, sub: group.label };
  }
  return { title: "TravelMind", sub: "Operations console" };
}

/**
 * The phone title, on its own so that only it re-renders on navigation (a re-render of the bar's tools would
 * re-create queries that signing out has just removed).
 */
function PageTitle() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { title, sub } = pageTitle(pathname);
  return (
    <div className="title grow">
      <b>{title}</b>
      <span>{sub}</span>
    </div>
  );
}

function DemoBadge() {
  return <span className="badge t-amber h-5 shrink-0 px-2 font-mono text-[10px] font-medium uppercase leading-none tracking-[0.1em]">Demo</span>;
}

/**
 * The kit top bar.
 * Desktop: the workspace (agency mark, name, demo badge), global search, then theme, notifications, help and account.
 * Phones: the logo, the page title and its section, then search, theme, notifications and account (the workspace
 * and help move to the tab bar's More sheet).
 */
export function TopBar({ me, phone }: { me: Me; phone: boolean }) {
  const { agency } = me;
  return (
    <header role="banner" className="topbar max-sm:gap-1.5">
      {phone ? (
        <>
          <Link to="/app" aria-label="TravelMind, Command Center" className="brand shrink-0 p-0">
            <BrandLogo />
          </Link>
          <PageTitle />
        </>
      ) : (
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <Link
            to="/app"
            className="flex min-w-0 items-center gap-2.5 rounded-[12px] py-1 pl-1 pr-2 transition-colors duration-150 ease-tm hover:bg-card-2"
          >
            <span
              aria-hidden="true"
              className="tm-brand-mark grid h-8 w-8 shrink-0 place-items-center rounded-[9px] text-[11px] font-semibold tracking-[0.02em] text-ink"
            >
              {initials(agency.name)}
            </span>
            <span className="min-w-0 max-w-56 truncate font-display text-[15px] font-semibold text-ink">{agency.name}</span>
          </Link>
          {agency.is_demo && <DemoBadge />}
        </div>
      )}
      <div className={phone ? "flex shrink-0" : "flex min-w-0 flex-1 justify-center px-2"}>
        <CommandPalette />
      </div>
      <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
        <ThemeSwitcher hideNameBelow="lg" />
        <NotificationsBell />
        {!phone && <HelpMenu />}
        {!phone && <span aria-hidden="true" className="mx-1 h-6 w-px bg-line" />}
        <UserMenu me={me} />
      </div>
    </header>
  );
}
