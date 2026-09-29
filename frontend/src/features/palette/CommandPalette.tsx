import { useNavigate } from "@tanstack/react-router";
import { Command } from "cmdk";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { useLogout } from "../../auth/useLogout";
import { useTheme } from "../../ui/theme";
import { useAirportSearch } from "../airports/useAirportSearch";
import { routeStore } from "../route/routeStore";

type PaletteCommand = { id: string; group: "Navigate" | "Actions"; label: string; keywords: string; run: () => void };

const GROUPS = ["Navigate", "Actions"] as const;
const itemClass =
  "flex cursor-pointer items-center gap-3 rounded-sm px-3 py-2 text-sm text-dim data-[selected=true]:bg-primary/15 data-[selected=true]:text-ink";
const groupClass =
  "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.22em] [&_[cmdk-group-heading]]:text-dim";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const [theme, setTheme] = useTheme();
  const logout = useLogout();
  const airports = useAirportSearch(search);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const close = () => {
    setOpen(false);
    setSearch("");
  };
  const runAndClose = (action: () => void) => {
    close();
    action();
  };

  const commands: PaletteCommand[] = [
    { id: "nav-mission", group: "Navigate", label: "Mission Control", keywords: "home dashboard globe route", run: () => void navigate({ to: "/" }) },
    { id: "nav-team", group: "Navigate", label: "Crew roster", keywords: "team members invite crew", run: () => void navigate({ to: "/team" }) },
    { id: "nav-design", group: "Navigate", label: "Design system", keywords: "styles components tokens", run: () => void navigate({ to: "/design" }) },
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
        aria-label="Open command palette"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={() => setOpen(true)}
        className="hidden h-8 items-center gap-2 rounded-sm border border-line px-2 text-xs text-dim transition hover:border-primary/70 hover:text-primary md:inline-flex"
      >
        <Search size={14} aria-hidden="true" />
        <span className="font-display uppercase tracking-[0.14em]">Command</span>
        <kbd className="rounded-sm border border-line px-1 font-mono text-[10px]">Ctrl K</kbd>
      </button>
      <Command.Dialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        label="Command palette"
        shouldFilter={false}
        overlayClassName="fixed inset-0 z-40 bg-void/70 backdrop-blur-sm"
        contentClassName="fixed left-1/2 top-[14vh] z-50 w-[min(40rem,92vw)] -translate-x-1/2 rounded-sm border border-line bg-raised p-2 shadow-2xl"
      >
        <Command.Input
          value={search}
          onValueChange={setSearch}
          placeholder="Type a command or an airport…"
          className="h-11 w-full border-b border-line bg-transparent px-3 text-ink outline-none placeholder:text-dim/60"
        />
        <Command.List className="max-h-[50vh] overflow-auto py-2">
          {!scanning && !airportError && (
            <Command.Empty className="px-3 py-6 text-center text-sm text-dim">No matches.</Command.Empty>
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
                <Command.Loading label="Scanning airports">
                  <span className="block px-3 py-2 font-mono text-xs uppercase tracking-[0.2em] text-dim">
                    Scanning airports…
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
                        void navigate({ to: "/" });
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
        <p className="border-t border-line px-3 pt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-dim">
          ↑↓ move · ↵ select · esc close · airports fill From, then To
        </p>
      </Command.Dialog>
    </>
  );
}
