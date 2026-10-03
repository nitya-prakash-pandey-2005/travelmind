import { Link } from "@tanstack/react-router";
import {
  BedDouble,
  ChartLine,
  FileText,
  LayoutDashboard,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Plane,
  PlugZap,
  Settings,
  SquareKanban,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "../ui/cn";

export type NavPath =
  | "/app"
  | "/app/pipeline"
  | "/app/quotes"
  | "/app/clients"
  | "/app/fares"
  | "/app/hotels"
  | "/app/routes"
  | "/app/team"
  | "/app/suppliers"
  | "/app/settings"
  | "/app/design";
type NavItem = { to: NavPath; label: string; icon: LucideIcon };
type NavGroup = { label: string; items: NavItem[] };

/** The sidebar's sections. The command palette offers the same destinations. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operate",
    items: [
      { to: "/app", label: "Command Center", icon: LayoutDashboard },
      { to: "/app/pipeline", label: "Pipeline", icon: SquareKanban },
      { to: "/app/quotes", label: "Quotes", icon: FileText },
      { to: "/app/clients", label: "Clients", icon: UserRound },
    ],
  },
  {
    label: "Market",
    items: [
      { to: "/app/fares", label: "Fare search", icon: Plane },
      { to: "/app/hotels", label: "Hotel search", icon: BedDouble },
      { to: "/app/routes", label: "Route intel", icon: ChartLine },
    ],
  },
  {
    label: "Admin",
    items: [
      { to: "/app/team", label: "Team", icon: Users },
      { to: "/app/suppliers", label: "Suppliers", icon: PlugZap },
      { to: "/app/settings", label: "Settings", icon: Settings },
      { to: "/app/design", label: "Design system", icon: Palette },
    ],
  },
];

const STORAGE_KEY = "tm-sidebar";

/** The product wordmark: Inter semibold with slight tracking. */
function Wordmark({ className }: { className?: string }) {
  return <span className={cn("text-[13px] font-semibold tracking-[0.02em]", className ?? "text-ink")}>TravelMind</span>;
}

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
          className="tm-fade-in fixed inset-0 z-40 bg-(--tm-backdrop) lg:hidden"
        />
      )}
      <div
        id={id}
        onKeyDown={onKeyDown}
        data-collapsed={collapsed}
        className={cn(
          "flex shrink-0 flex-col border-line bg-surface",
          // Small screens: an off-canvas drawer, hidden (and out of the tab order) until opened.
          "fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] border-r shadow-(--tm-shadow-pop)",
          "transition-[translate,visibility] duration-180 ease-tm",
          mobileOpen ? "visible translate-x-0" : "invisible -translate-x-full",
          // Large screens: a column beside the page, collapsible to an icon rail.
          // Raised above the page so the icon rail's tooltips paint over panels.
          "lg:visible lg:relative lg:z-20 lg:max-w-none lg:translate-x-0 lg:shadow-none",
          "lg:transition-[width] lg:duration-150",
          collapsed ? "lg:w-14" : "lg:w-60",
        )}
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4 lg:hidden">
          <Wordmark />
          <button
            ref={closeRef}
            type="button"
            aria-label="Close navigation"
            onClick={() => onCloseMobile(true)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-dim transition-colors duration-150 ease-tm hover:bg-hover hover:text-ink"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <nav
          aria-label="Primary"
          className={cn(
            "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden px-2 py-3",
            // The icon rail's tooltips reach past its edge.
            collapsed && "lg:overflow-visible",
          )}
        >
          {NAV_GROUPS.map((group) => {
            const headingId = `${headingPrefix}-${group.label}`;
            return (
              <div key={group.label} className="flex flex-col gap-0.5">
                <h2
                  id={headingId}
                  className={cn(
                    "tm-micro px-2.5 pb-1 pt-1",
                    collapsed && "lg:sr-only",
                  )}
                >
                  {group.label}
                </h2>
                {collapsed && <span aria-hidden="true" className="mx-2 mb-1 hidden h-px bg-line lg:block" />}
                <ul aria-labelledby={headingId} className="flex flex-col gap-0.5">
                  {group.items.map(({ to, label, icon: Icon }) => (
                    <li key={to}>
                      <Link
                        to={to}
                        activeOptions={{ exact: to === "/app" }}
                        onClick={() => onCloseMobile(false)}
                        className={cn(
                          "group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-dim",
                          "transition-colors duration-150 ease-tm hover:bg-hover hover:text-ink",
                          // Active: surface-2 fill, a 2px accent bar on the left edge, ink text.
                          "before:absolute before:inset-y-1.5 before:-left-2 before:w-0.5 before:rounded-r-full",
                          "before:bg-primary before:opacity-0",
                          "data-[status=active]:bg-surface-2 data-[status=active]:text-ink data-[status=active]:before:opacity-100",
                          collapsed && "lg:justify-center lg:px-0",
                        )}
                      >
                        <Icon
                          size={16}
                          strokeWidth={1.75}
                          aria-hidden="true"
                          className="shrink-0 transition-colors group-data-[status=active]:text-primary"
                        />
                        <span className={cn("truncate", collapsed && "lg:sr-only")}>{label}</span>
                        {collapsed && (
                          <span
                            aria-hidden="true"
                            className={cn(
                              "tm-popover pointer-events-none absolute left-full top-1/2 z-50 ml-3 hidden -translate-y-1/2 whitespace-nowrap rounded-md",
                              "px-2 py-1 text-xs font-medium text-ink",
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
        <div className="hidden h-11 shrink-0 items-center gap-2 border-t border-line px-2 lg:flex">
          <button
            type="button"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            aria-controls={id}
            onClick={toggle}
            className={cn(
              "inline-flex h-8 items-center gap-2 rounded-md px-2 text-dim transition-colors duration-150 ease-tm hover:bg-hover hover:text-ink",
              collapsed ? "w-full justify-center" : "w-auto",
            )}
          >
            {collapsed ? (
              <PanelLeftOpen size={16} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={16} strokeWidth={1.75} aria-hidden="true" />
            )}
          </button>
          {!collapsed && <Wordmark className="ml-auto pr-1 text-faint" />}
        </div>
      </div>
    </>
  );
}
