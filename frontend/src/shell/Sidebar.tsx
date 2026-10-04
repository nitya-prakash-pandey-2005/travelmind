import { Link, useRouterState } from "@tanstack/react-router";
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
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { cn } from "../ui/cn";

export type NavPath =
  | "/app"
  | "/app/pipeline"
  | "/app/quotes"
  | "/app/clients"
  | "/app/agent"
  | "/app/fares"
  | "/app/hotels"
  | "/app/routes"
  | "/app/team"
  | "/app/suppliers"
  | "/app/settings"
  | "/app/design";
export type NavItem = {
  to: NavPath;
  label: string;
  icon: LucideIcon;
  /** Other path prefixes that belong to this item (an enquiry page sits under Pipeline). */
  also?: string[];
};
export type NavGroup = { label: string; items: NavItem[] };

/** The sidebar's sections. The command palette, the phone tab bar and its More sheet offer the same destinations. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operate",
    items: [
      { to: "/app", label: "Command Center", icon: LayoutDashboard },
      { to: "/app/pipeline", label: "Pipeline", icon: SquareKanban, also: ["/app/enquiries/"] },
      { to: "/app/quotes", label: "Quotes", icon: FileText },
      { to: "/app/clients", label: "Clients", icon: UserRound },
      { to: "/app/agent", label: "Agent", icon: Waypoints },
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

/** True when `pathname` is this item's page or one that belongs to it (exact for the Command Center). */
export function isNavActive(item: Pick<NavItem, "to" | "also">, pathname: string): boolean {
  if (item.to === "/app") return pathname === "/app" || pathname === "/app/";
  return pathname === item.to || pathname.startsWith(`${item.to}/`) || Boolean(item.also?.some((prefix) => pathname.startsWith(prefix)));
}

/** The product mark: the orbit logo in a glowing tile (the kit's brand block). */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <span className={cn("logo", className)} aria-hidden="true">
      <img src="/favicon.svg" width={26} height={26} alt="" />
    </span>
  );
}

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

/**
 * The kit sidebar (desktop, above 900 px): brand block, nav groups under HUD labels, the active item on the soft
 * gradient with a gradient rail, and a collapse to an icon rail (remembered per browser). Phones use the bottom
 * tab bar and its More sheet instead (BottomTabs).
 */
export function Sidebar({ id }: { id: string }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const headingPrefix = useId();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    storeCollapsed(next);
  }

  return (
    <aside id={id} className="sidebar" data-collapsed={collapsed}>
      <div className="nav-scroll">
        <Link to="/app" className="brand" aria-label={collapsed ? "TravelMind, Command Center" : undefined}>
          <BrandLogo />
          {!collapsed && (
            <span className="min-w-0">
              <b>TravelMind</b>
              <span className="sub block">Operations console</span>
            </span>
          )}
        </Link>
        <nav aria-label="Primary" className="flex flex-col">
          {NAV_GROUPS.map((group) => {
            const headingId = `${headingPrefix}-${group.label}`;
            return (
              <div key={group.label} className="nav-group">
                <h2 id={headingId} className={cn("hud", collapsed && "sr-only")}>
                  {group.label}
                </h2>
                {collapsed && <span aria-hidden="true" className="mx-2 mb-1 block h-px bg-line" />}
                <ul aria-labelledby={headingId} className="flex flex-col gap-0.5">
                  {group.items.map(({ to, label, icon: Icon, also }) => (
                    <li key={to}>
                      <Link
                        to={to}
                        activeOptions={{ exact: to === "/app" }}
                        // The router marks only its own path active; a related page is marked here the same way.
                        {...(also?.some((prefix) => pathname.startsWith(prefix))
                          ? { "data-status": "active", "aria-current": "page" as const }
                          : {})}
                        className="nav-link group"
                      >
                        <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                        <span className={cn("truncate", collapsed && "sr-only")}>{label}</span>
                        {collapsed && (
                          <span
                            aria-hidden="true"
                            className={cn(
                              "tm-popover pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md",
                              "px-2.5 py-1 text-xs font-medium text-ink",
                              "opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100",
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
      </div>
      <div className={cn("foot flex items-center", collapsed && "justify-center px-2")}>
        <button
          type="button"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          aria-controls={id}
          onClick={toggle}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-dim transition-colors duration-150 ease-tm hover:bg-card-2 hover:text-ink"
        >
          {collapsed ? (
            <PanelLeftOpen size={17} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <PanelLeftClose size={17} strokeWidth={1.75} aria-hidden="true" />
          )}
        </button>
      </div>
    </aside>
  );
}
