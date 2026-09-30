import { Menu as MenuIcon } from "lucide-react";
import type { Ref } from "react";
import type { Me } from "../api/types";
import { CommandPalette } from "../features/palette/CommandPalette";
import { initials } from "../ui/Avatar";
import { ThemeToggle } from "../ui/ThemeToggle";
import { NotificationsBell } from "./NotificationsBell";
import { UserMenu } from "./UserMenu";

type TopBarProps = {
  me: Me;
  sidebarId: string;
  navOpen: boolean;
  onOpenNav: () => void;
  navButtonRef: Ref<HTMLButtonElement>;
};

/** Agency identity on the left, global search in the middle, notifications, theme and account on the right. */
export function TopBar({ me, sidebarId, navOpen, onOpenNav, navButtonRef }: TopBarProps) {
  const { agency } = me;
  return (
    <header
      role="banner"
      className="relative z-30 flex h-14 shrink-0 items-center gap-1.5 border-b border-line bg-glass px-3 backdrop-blur-xl sm:gap-3 lg:px-4"
    >
      <button
        ref={navButtonRef}
        type="button"
        aria-label="Open navigation"
        aria-expanded={navOpen}
        aria-controls={sidebarId}
        onClick={onOpenNav}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-dim transition-colors duration-200 ease-tm hover:bg-hover hover:text-ink lg:hidden"
      >
        <MenuIcon size={18} aria-hidden="true" />
      </button>
      <div className="flex min-w-0 items-center gap-2.5 lg:w-[13.5rem] lg:shrink-0">
        <span
          aria-hidden="true"
          className="tm-brand-mark grid h-8 w-8 shrink-0 place-items-center rounded-md font-display text-xs font-semibold tracking-wider text-ink"
        >
          {initials(agency.name)}
        </span>
        <div className="flex min-w-0 flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:gap-2">
          <span className="max-w-full truncate font-display text-sm tracking-wide text-ink max-sm:text-xs">
            {agency.name}
          </span>
          {agency.is_demo && (
            <span className="tm-tint inline-flex shrink-0 items-center rounded-sm border px-1.5 py-px font-mono text-[10px] font-medium uppercase leading-4 tracking-[0.14em] text-warn">
              DEMO WORKSPACE
            </span>
          )}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 justify-end sm:justify-center">
        <CommandPalette />
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
        <NotificationsBell />
        <span className="max-sm:hidden">
          <ThemeToggle />
        </span>
        <UserMenu me={me} />
      </div>
    </header>
  );
}
