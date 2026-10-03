import { useNavigate } from "@tanstack/react-router";
import { Command } from "cmdk";
import {
  BedDouble,
  ChartLine,
  FileText,
  Inbox,
  LayoutDashboard,
  LogOut,
  Moon,
  Palette,
  Plane,
  PlugZap,
  Search,
  Settings,
  SquareKanban,
  Sun,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { useLogout } from "../../auth/useLogout";
import { cn } from "../../ui/cn";
import { Kbd } from "../../ui/Kbd";
import { useModeToggle } from "../../theme";
import { useAirportSearch } from "../airports/useAirportSearch";
import { routeStore } from "../route/routeStore";
import { formatRoute, Status } from "./recordParts";
import { useRecordSearch } from "./useRecordSearch";

type PaletteCommand = {
  id: string;
  group: "Navigate" | "Actions";
  label: string;
  icon: LucideIcon;
  keywords: string;
  run: () => void;
};

const GROUPS = ["Navigate", "Actions"] as const;
const itemClass = cn(
  "group/item relative flex h-9 cursor-pointer items-center gap-3 rounded-md px-2.5 text-[13px] text-dim",
  "data-[selected=true]:bg-surface-2 data-[selected=true]:text-ink",
);
const iconClass = "shrink-0 text-faint group-data-[selected=true]/item:text-ink";
const groupClass =
  "px-1.5 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:leading-4 [&_[cmdk-group-heading]]:tracking-[0.06em] [&_[cmdk-group-heading]]:text-faint";
/** The IATA code chip, as in the airport picker. */
const codeClass =
  "inline-flex h-5 min-w-10 shrink-0 items-center justify-center rounded-[4px] border border-line px-1 font-mono text-xs font-semibold text-ink group-data-[selected=true]/item:border-primary/40 group-data-[selected=true]/item:text-primary";

/**
 * Global search and commands (Ctrl/⌘+K or the top bar's search field): navigation, actions, the
 * agency's clients, enquiries and quotes (each opens its page), and airports (placed on the route).
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const modeToggle = useModeToggle();
  const logout = useLogout();
  const airports = useAirportSearch(search);
  const records = useRecordSearch(search);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        // A modal (a drawer, a form dialog) owns the screen; the palette would open behind it.
        if (document.querySelector("dialog[open]")) return;
        // Closing by shortcut resets the search exactly like close() does for Escape, overlay and select.
        if (open) {
          setOpen(false);
          setSearch("");
        } else {
          setOpen(true);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    setSearch("");
  };
  const runAndClose = (action: () => void) => {
    close();
    action();
  };

  const commands: PaletteCommand[] = [
    { id: "nav-command", group: "Navigate", label: "Command Center", icon: LayoutDashboard, keywords: "home dashboard mission control metrics globe route", run: () => void navigate({ to: "/app" }) },
    { id: "nav-pipeline", group: "Navigate", label: "Pipeline", icon: SquareKanban, keywords: "enquiries board kanban stages leads won lost", run: () => void navigate({ to: "/app/pipeline" }) },
    { id: "nav-quotes", group: "Navigate", label: "Quotes", icon: FileText, keywords: "proposals offers markup send share link accepted", run: () => void navigate({ to: "/app/quotes" }) },
    { id: "nav-clients", group: "Navigate", label: "Clients", icon: UserRound, keywords: "customers travellers companies contacts", run: () => void navigate({ to: "/app/clients" }) },
    { id: "nav-fares", group: "Navigate", label: "Fare search", icon: Plane, keywords: "flights fares prices offers scan", run: () => void navigate({ to: "/app/fares" }) },
    { id: "nav-hotels", group: "Navigate", label: "Hotel search", icon: BedDouble, keywords: "hotels rooms stay accommodation scan", run: () => void navigate({ to: "/app/hotels" }) },
    { id: "nav-routes", group: "Navigate", label: "Route intel", icon: ChartLine, keywords: "route intelligence fare history trends median carriers", run: () => void navigate({ to: "/app/routes" }) },
    { id: "nav-team", group: "Navigate", label: "Team", icon: Users, keywords: "team members invite crew roster", run: () => void navigate({ to: "/app/team" }) },
    { id: "nav-suppliers", group: "Navigate", label: "Suppliers", icon: PlugZap, keywords: "suppliers connections keys duffel liteapi data", run: () => void navigate({ to: "/app/suppliers" }) },
    { id: "nav-settings", group: "Navigate", label: "Settings", icon: Settings, keywords: "agency profile branding brand colour color timezone", run: () => void navigate({ to: "/app/settings" }) },
    { id: "nav-design", group: "Navigate", label: "Design system", icon: Palette, keywords: "styles components tokens", run: () => void navigate({ to: "/app/design" }) },
    ...(modeToggle.available
      ? [
          {
            id: "theme",
            group: "Actions",
            label: modeToggle.label,
            icon: modeToggle.mode === "dark" ? Sun : Moon,
            keywords: "theme light dark daylight mode",
            run: modeToggle.toggle,
          } satisfies PaletteCommand,
        ]
      : []),
    { id: "logout", group: "Actions", label: "Sign out", icon: LogOut, keywords: "logout exit leave", run: () => logout.mutate() },
  ];
  const needle = search.trim().toLowerCase();
  const visible = needle
    ? commands.filter((c) => `${c.label} ${c.keywords}`.toLowerCase().includes(needle))
    : commands;

  // Results that belong to an earlier term are never rendered as items, so neither Enter nor a click
  // can pick one before the live term's results arrive.
  const scanning = airports.enabled && (airports.isStale || (airports.isSearching && airports.results.length === 0));
  const airportError =
    airports.enabled && !airports.isStale && airports.error
      ? airports.error instanceof ApiError
        ? airports.error.message
        : "Airport search failed."
      : null;

  return (
    <>
      <button
        type="button"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={() => setOpen(true)}
        className={cn(
          "group inline-flex h-8 min-w-0 items-center gap-2 rounded-md text-[13px] transition-colors duration-150 ease-tm",
          // Phones: an icon button. From 640px: a search field.
          "w-8 justify-center text-dim hover:bg-hover hover:text-ink",
          "sm:w-full sm:max-w-md sm:justify-start sm:border sm:border-line sm:bg-surface-2 sm:pl-2.5 sm:pr-1.5 sm:text-faint",
          "sm:hover:border-line-strong sm:hover:bg-surface-2 sm:hover:text-dim",
        )}
      >
        <Search size={15} aria-hidden="true" className="shrink-0" />
        <span className="truncate max-sm:sr-only">Search clients, enquiries, quotes…</span>
        <Kbd className="ml-auto shrink-0 max-sm:hidden">Ctrl K</Kbd>
      </button>
      <Command.Dialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        label="Command palette"
        shouldFilter={false}
        overlayClassName="fixed inset-0 z-40 bg-(--tm-backdrop)"
        contentClassName="tm-popover fixed left-1/2 top-[12vh] z-50 flex w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-lg"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={16} aria-hidden="true" className="shrink-0 text-faint" />
          <Command.Input
            value={search}
            onValueChange={setSearch}
            placeholder="Type a command or an airport, or find a client, enquiry or quote…"
            className="h-12 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
          />
          <Kbd className="shrink-0 max-sm:hidden">Esc</Kbd>
        </div>
        <Command.List className="max-h-[min(26rem,55vh)] overflow-auto py-1.5">
          {!scanning && !airportError && !records.pending && (
            <Command.Empty className="px-4 py-8 text-center text-[13px] text-dim">
              {search.trim() ? `No results for “${search.trim()}”` : "No matches."}
            </Command.Empty>
          )}
          {records.error && (
            <p className="px-4 py-2 text-[13px] text-dim">
              {records.error instanceof ApiError ? records.error.message : "Record search failed."}
            </p>
          )}
          {records.results.clients.length > 0 && (
            <Command.Group heading="Clients" className={groupClass}>
              {records.results.clients.map((client) => (
                <Command.Item
                  key={client.id}
                  value={`client-${client.id}`}
                  onSelect={() => runAndClose(() => void navigate({ to: "/app/clients/$clientId", params: { clientId: client.id } }))}
                  className={itemClass}
                >
                  <UserRound size={15} aria-hidden="true" className={iconClass} />
                  <span className="truncate text-ink">{client.name}</span>
                  <span className="ml-auto truncate text-xs text-faint">
                    {[client.company_name, client.email].filter(Boolean).join(" · ")}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
          {records.results.enquiries.length > 0 && (
            <Command.Group heading="Enquiries" className={groupClass}>
              {records.results.enquiries.map((enquiry) => (
                <Command.Item
                  key={enquiry.id}
                  value={`enquiry-${enquiry.id}`}
                  onSelect={() =>
                    runAndClose(() => void navigate({ to: "/app/enquiries/$enquiryId", params: { enquiryId: enquiry.id } }))
                  }
                  className={itemClass}
                >
                  <Inbox size={15} aria-hidden="true" className={iconClass} />
                  <span className="font-mono text-ink">{enquiry.number}</span>
                  <span className="truncate font-mono text-xs text-dim">{formatRoute(enquiry.origin, enquiry.destination)}</span>
                  <span className="ml-auto shrink-0">
                    <Status status={enquiry.status} />
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
          {records.results.quotes.length > 0 && (
            <Command.Group heading="Quotes" className={groupClass}>
              {records.results.quotes.map((quote) => (
                <Command.Item
                  key={quote.id}
                  value={`quote-${quote.id}`}
                  onSelect={() => runAndClose(() => void navigate({ to: "/app/quotes/$quoteId", params: { quoteId: quote.id } }))}
                  className={itemClass}
                >
                  <FileText size={15} aria-hidden="true" className={iconClass} />
                  <span className="font-mono text-ink">{quote.number}</span>
                  <span className="truncate text-xs text-dim">{quote.client_name ?? "No client"}</span>
                  <span className="ml-auto shrink-0">
                    <Status status={quote.status} />
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
          {GROUPS.map((group) => {
            const items = visible.filter((c) => c.group === group);
            if (items.length === 0) return null;
            return (
              <Command.Group key={group} heading={group} className={groupClass}>
                {items.map(({ id, label, icon: Icon, run }) => (
                  <Command.Item key={id} value={id} onSelect={() => runAndClose(run)} className={itemClass}>
                    <Icon size={15} aria-hidden="true" className={iconClass} />
                    {label}
                  </Command.Item>
                ))}
              </Command.Group>
            );
          })}
          {airports.enabled && (
            <Command.Group heading="Airports" className={groupClass}>
              {scanning ? (
                <Command.Loading label="Searching airports">
                  <span className="block px-2.5 py-2 text-[13px] text-dim">
                    Searching airports…
                  </span>
                </Command.Loading>
              ) : airportError ? (
                <p role="alert" className="px-2.5 py-2 text-[13px] text-danger">
                  {airportError}
                </p>
              ) : (
                airports.results.map((airport) => (
                  <Command.Item
                    key={airport.iata_code}
                    value={`airport-${airport.iata_code}`}
                    onSelect={() =>
                      runAndClose(() => {
                        routeStore.place(airport);
                        void navigate({ to: "/app" });
                      })
                    }
                    className={itemClass}
                  >
                    <span className={codeClass}>{airport.iata_code}</span>
                    <span className="truncate text-ink">{airport.name}</span>
                    <span className="ml-auto truncate text-xs text-faint">
                      {[airport.city, airport.country_name].filter(Boolean).join(", ")}
                    </span>
                  </Command.Item>
                ))
              )}
            </Command.Group>
          )}
        </Command.List>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-surface-2/50 px-4 py-2 text-[11px] leading-4 text-faint">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            Move
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>Enter</Kbd>
            Open
          </span>
          <span className="inline-flex items-center gap-1.5 max-sm:hidden">
            <Kbd>Esc</Kbd>
            Close
          </span>
          <span className="ml-auto">Airports fill From, then To</span>
        </div>
      </Command.Dialog>
    </>
  );
}
