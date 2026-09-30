import { useNavigate } from "@tanstack/react-router";
import { Command } from "cmdk";
import { FileText, Inbox, Search, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { useLogout } from "../../auth/useLogout";
import { cn } from "../../ui/cn";
import { Kbd } from "../../ui/Kbd";
import { useTheme } from "../../ui/theme";
import { useAirportSearch } from "../airports/useAirportSearch";
import { routeStore } from "../route/routeStore";
import { formatRoute, RecordDrawer, Status, type RecordSelection } from "./RecordDrawer";
import { useRecordSearch } from "./useRecordSearch";

type PaletteCommand = { id: string; group: "Navigate" | "Actions"; label: string; keywords: string; run: () => void };

const GROUPS = ["Navigate", "Actions"] as const;
const itemClass =
  "flex h-9 cursor-pointer items-center gap-3 rounded-md px-3 text-[13px] text-dim data-[selected=true]:bg-hover data-[selected=true]:text-ink";
const groupClass =
  "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.06em] [&_[cmdk-group-heading]]:text-faint";

/**
 * Global search and commands (Ctrl/⌘+K or the top bar's search field): navigation, actions, the
 * agency's clients, enquiries and quotes (opened in a drawer), and airports (placed on the route).
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [record, setRecord] = useState<RecordSelection | null>(null);
  const navigate = useNavigate();
  const [theme, setTheme] = useTheme();
  const logout = useLogout();
  const airports = useAirportSearch(search);
  const records = useRecordSearch(search);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        // A modal (a record drawer, a form dialog) owns the screen; the palette would open behind it.
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
  const openRecord = (selection: RecordSelection) => runAndClose(() => setRecord(selection));

  const commands: PaletteCommand[] = [
    { id: "nav-command", group: "Navigate", label: "Command Center", keywords: "home dashboard mission control metrics globe route", run: () => void navigate({ to: "/app" }) },
    { id: "nav-fares", group: "Navigate", label: "Fare search", keywords: "flights fares prices offers scan", run: () => void navigate({ to: "/app/fares" }) },
    { id: "nav-hotels", group: "Navigate", label: "Hotel search", keywords: "hotels rooms stay accommodation scan", run: () => void navigate({ to: "/app/hotels" }) },
    { id: "nav-team", group: "Navigate", label: "Team", keywords: "team members invite crew roster", run: () => void navigate({ to: "/app/team" }) },
    { id: "nav-suppliers", group: "Navigate", label: "Suppliers", keywords: "suppliers connections keys duffel liteapi data", run: () => void navigate({ to: "/app/suppliers" }) },
    { id: "nav-design", group: "Navigate", label: "Design system", keywords: "styles components tokens", run: () => void navigate({ to: "/app/design" }) },
    {
      id: "theme",
      group: "Actions",
      label: theme === "dark" ? "Switch to daylight theme" : "Switch to dark theme",
      keywords: "theme light dark daylight mode",
      run: () => setTheme(theme === "dark" ? "daylight" : "dark"),
    },
    { id: "logout", group: "Actions", label: "Sign out", keywords: "logout exit leave", run: () => logout.mutate() },
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
        contentClassName="tm-popover fixed left-1/2 top-[14vh] z-50 w-[min(40rem,92vw)] -translate-x-1/2 rounded-lg p-1.5"
      >
        <Command.Input
          value={search}
          onValueChange={setSearch}
          placeholder="Type a command or an airport, or find a client, enquiry or quote…"
          className="h-11 w-full border-b border-line bg-transparent px-3 text-sm text-ink outline-none placeholder:text-faint"
        />
        <Command.List className="max-h-[50vh] overflow-auto py-2">
          {!scanning && !airportError && !records.pending && (
            <Command.Empty className="px-3 py-6 text-center text-sm text-dim">No matches.</Command.Empty>
          )}
          {records.error && (
            <p className="px-3 py-2 text-sm text-dim">
              {records.error instanceof ApiError ? records.error.message : "Record search failed."}
            </p>
          )}
          {records.results.clients.length > 0 && (
            <Command.Group heading="Clients" className={groupClass}>
              {records.results.clients.map((client) => (
                <Command.Item
                  key={client.id}
                  value={`client-${client.id}`}
                  onSelect={() => openRecord({ type: "client", record: client })}
                  className={itemClass}
                >
                  <UserRound size={15} aria-hidden="true" className="shrink-0 text-primary" />
                  <span className="truncate text-ink">{client.name}</span>
                  <span className="ml-auto truncate text-xs">
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
                  onSelect={() => openRecord({ type: "enquiry", record: enquiry })}
                  className={itemClass}
                >
                  <Inbox size={15} aria-hidden="true" className="shrink-0 text-primary" />
                  <span className="font-mono text-ink">{enquiry.number}</span>
                  <span className="truncate font-mono text-xs">{formatRoute(enquiry.origin, enquiry.destination)}</span>
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
                  onSelect={() => openRecord({ type: "quote", record: quote })}
                  className={itemClass}
                >
                  <FileText size={15} aria-hidden="true" className="shrink-0 text-primary" />
                  <span className="font-mono text-ink">{quote.number}</span>
                  <span className="truncate text-xs">{quote.client_name ?? "No client"}</span>
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
                {items.map((command) => (
                  <Command.Item key={command.id} value={command.id} onSelect={() => runAndClose(command.run)} className={itemClass}>
                    {command.label}
                  </Command.Item>
                ))}
              </Command.Group>
            );
          })}
          {airports.enabled && (
            <Command.Group heading="Airports" className={groupClass}>
              {scanning ? (
                <Command.Loading label="Searching airports">
                  <span className="block px-3 py-2 text-[13px] text-dim">
                    Searching airports…
                  </span>
                </Command.Loading>
              ) : airportError ? (
                <p role="alert" className="px-3 py-2 text-sm text-danger">
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
                    <span className="w-10 font-mono text-primary">{airport.iata_code}</span>
                    <span className="truncate text-ink">{airport.name}</span>
                    <span className="ml-auto truncate text-xs">
                      {[airport.city, airport.country_name].filter(Boolean).join(", ")}
                    </span>
                  </Command.Item>
                ))
              )}
            </Command.Group>
          )}
        </Command.List>
        <p className="border-t border-line px-3 pb-1 pt-2 text-[11px] leading-4 text-faint">
          ↑↓ to move · Enter to select · Esc to close · Airports fill From, then To
        </p>
      </Command.Dialog>
      <RecordDrawer selection={record} onClose={() => setRecord(null)} />
    </>
  );
}
