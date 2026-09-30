import { Link } from "@tanstack/react-router";
import { Menu as MenuIcon } from "lucide-react";
import type { Ref } from "react";
import type { Me } from "../api/types";
import { CommandPalette } from "../features/palette/CommandPalette";
import { initials } from "../ui/Avatar";
import { HelpMenu } from "./HelpMenu";
import { NotificationsBell } from "./NotificationsBell";
import { UserMenu } from "./UserMenu";

type TopBarProps = {
  me: Me;
  sidebarId: string;
  navOpen: boolean;
  onOpenNav: () => void;
  navButtonRef: Ref<HTMLButtonElement>;
};

/** 48px bar: workspace (agency mark and name) on the left, global search, then notifications, help and account. */
export function TopBar({ me, sidebarId, navOpen, onOpenNav, navButtonRef }: TopBarProps) {
  const { agency } = me;
  return (
    <header
      role="banner"
      className="relative z-30 flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 sm:gap-3 lg:px-3"
    >
      <button
        ref={navButtonRef}
        type="button"
        aria-label="Open navigation"
        aria-expanded={navOpen}
        aria-controls={sidebarId}
        onClick={onOpenNav}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-dim transition-colors duration-150 ease-tm hover:bg-hover hover:text-ink lg:hidden"
      >
        <MenuIcon size={18} aria-hidden="true" />
      </button>
      {/* Workspace: fills the sidebar's 240px column on desktop so the search lines up with the page. */}
      <div className="flex min-w-0 items-center gap-2 lg:w-[14.25rem] lg:shrink-0">
        <Link
          to="/app"
          className="flex min-w-0 items-center gap-2.5 rounded-md py-1 pl-1 pr-2 transition-colors duration-150 ease-tm hover:bg-hover"
        >
          <span
            aria-hidden="true"
            className="tm-brand-mark grid h-6 w-6 shrink-0 place-items-center rounded-[5px] text-[10px] font-semibold tracking-[0.02em] text-ink"
          >
            {initials(agency.name)}
          </span>
          <span className="min-w-0 truncate text-[13px] font-semibold text-ink">{agency.name}</span>
        </Link>
        {agency.is_demo && (
          <span className="tm-tint inline-flex h-5 shrink-0 items-center rounded-full border px-2 font-mono text-[10px] font-medium uppercase leading-none tracking-[0.06em] text-warn">
            Demo
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 justify-end sm:justify-center lg:justify-start">
        <CommandPalette />
      </div>
      <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
        <NotificationsBell />
        <span className="max-sm:hidden">
          <HelpMenu />
        </span>
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-line max-sm:hidden" />
        <UserMenu me={me} />
      </div>
    </header>
  );
}
