import { Link } from "@tanstack/react-router";
import {
  BedDouble,
  LayoutDashboard,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Plane,
  PlugZap,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "../ui/cn";

type NavItem = {
  to: "/app" | "/app/fares" | "/app/hotels" | "/app/team" | "/app/suppliers" | "/app/design";
  label: string;
  icon: LucideIcon;
};
type NavGroup = { label: string; items: NavItem[] };

/** The sidebar's sections. The command palette offers the same destinations. */
export const NAV_GROUPS: NavGroup[] = [
  { label: "Operate", items: [{ to: "/app", label: "Command Center", icon: LayoutDashboard }] },
  {
    label: "Market",
    items: [
      { to: "/app/fares", label: "Fare scan", icon: Plane },
      { to: "/app/hotels", label: "Hotel scan", icon: BedDouble },
    ],
  },
  {
    label: "Admin",
    items: [
      { to: "/app/team", label: "Crew roster", icon: Users },
      { to: "/app/suppliers", label: "Suppliers", icon: PlugZap },
      { to: "/app/design", label: "Design system", icon: Palette },
    ],
  },
];

const STORAGE_KEY = "tm-sidebar";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "collapsed";
  } catch {
    return false;
  }
}

function storeCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, collapsed ? "collapsed" : "expanded");
  } catch {
    // Storage blocked: the choice still holds for this visit.
  }
}

type SidebarProps = {
  id: string;
  /** Small screens: the sidebar is an overlay drawer, open while this is true. */
  mobileOpen: boolean;
  /** Close the drawer; `restoreFocus` returns focus to the button that opened it. */
  onCloseMobile: (restoreFocus: boolean) => void;
};

/**
 * Grouped primary navigation. From 1024 px it sits beside the page and can collapse to an icon rail
 * (remembered per browser); below that it is an overlay drawer opened from the top bar.
 */
export function Sidebar({ id, mobileOpen, onCloseMobile }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const headingPrefix = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (mobileOpen) closeRef.current?.focus();
  }, [mobileOpen]);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    storeCollapsed(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (mobileOpen && event.key === "Escape") {
      event.preventDefault();
      onCloseMobile(true);
    }
  }

  return (
    <>
      {mobileOpen && (
        <div
          aria-hidden="true"
          onClick={() => onCloseMobile(true)}
          className="tm-fade-in fixed inset-0 z-40 bg-(--tm-backdrop) backdrop-blur-[3px] lg:hidden"
        />
      )}
      <div
        id={id}
        onKeyDown={onKeyDown}
        data-collapsed={collapsed}
        className={cn(
          "flex shrink-0 flex-col border-line bg-glass-strong backdrop-blur-xl",
          // Small screens: an off-canvas drawer, hidden (and out of the tab order) until opened.
          "fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] border-r shadow-(--tm-shadow-pop)",
          "transition-[translate,visibility] duration-200 ease-tm",
          mobileOpen ? "visible translate-x-0" : "invisible -translate-x-full",
          // Large screens: a column beside the page, collapsible to an icon rail.
          // Raised above the page so the icon rail's tooltips paint over panels.
          "lg:visible lg:relative lg:z-20 lg:max-w-none lg:translate-x-0 lg:bg-glass lg:shadow-none",
          "lg:transition-[width]",
          collapsed ? "lg:w-[4.25rem]" : "lg:w-60",
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4 lg:hidden">
          <span className="font-display text-sm tracking-[0.35em] text-primary">TRAVELMIND</span>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close navigation"
            onClick={() => onCloseMobile(true)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-dim transition-colors duration-200 ease-tm hover:bg-hover hover:text-ink"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <nav
          aria-label="Primary"
          className={cn(
            "flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden px-3 py-4",
            // The icon rail's tooltips reach past its edge.
            collapsed && "lg:overflow-visible",
          )}
        >
          {NAV_GROUPS.map((group) => {
            const headingId = `${headingPrefix}-${group.label}`;
            return (
              <div key={group.label} className="flex flex-col gap-1">
                <h2
                  id={headingId}
                  className={cn(
                    "px-3 pb-1 font-mono text-[10px] font-medium uppercase tracking-[0.24em] text-dim",
                    collapsed && "lg:sr-only",
                  )}
                >
                  {group.label}
                </h2>
                {collapsed && <span aria-hidden="true" className="mx-3 mb-1 hidden h-px bg-line lg:block" />}
                <ul aria-labelledby={headingId} className="flex flex-col gap-0.5">
                  {group.items.map(({ to, label, icon: Icon }) => (
                    <li key={to}>
                      <Link
                        to={to}
                        activeOptions={{ exact: to === "/app" }}
                        onClick={() => onCloseMobile(false)}
                        className={cn(
                          "group relative flex h-9 items-center gap-3 rounded-md px-3 text-sm text-dim",
                          "transition-colors duration-200 ease-tm hover:bg-hover hover:text-ink",
                          // Active marker: a slim bar tinted with the agency's brand colour.
                          "before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full",
                          "before:bg-(--tm-brand) before:opacity-0 before:transition-opacity",
                          "data-[status=active]:bg-raised data-[status=active]:text-ink data-[status=active]:before:opacity-100",
                          collapsed && "lg:justify-center lg:px-0",
                        )}
                      >
                        <Icon
                          size={17}
                          strokeWidth={1.75}
                          aria-hidden="true"
                          className="shrink-0 transition-colors group-data-[status=active]:text-primary"
                        />
                        <span className={cn("truncate", collapsed && "lg:sr-only")}>{label}</span>
                        {collapsed && (
                          <span
                            aria-hidden="true"
                            className={cn(
                              "pointer-events-none absolute left-full top-1/2 z-50 ml-3 hidden -translate-y-1/2 whitespace-nowrap rounded-sm",
                              "border border-line bg-glass-strong px-2 py-1 text-xs text-ink shadow-(--tm-shadow-pop)",
                              "opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 lg:block",
                            )}
                          >
                            {label}
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className="hidden shrink-0 items-center gap-2 border-t border-line p-3 lg:flex">
          <button
            type="button"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            aria-controls={id}
            onClick={toggle}
            className={cn(
              "inline-flex h-8 items-center gap-2 rounded-md px-2 text-dim transition-colors duration-200 ease-tm hover:bg-hover hover:text-ink",
              collapsed ? "w-full justify-center" : "w-auto",
            )}
          >
            {collapsed ? (
              <PanelLeftOpen size={17} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={17} strokeWidth={1.75} aria-hidden="true" />
            )}
          </button>
          {!collapsed && (
            <span className="ml-auto font-display text-[10px] tracking-[0.35em] text-dim">TRAVELMIND</span>
          )}
        </div>
      </div>
    </>
  );
}
