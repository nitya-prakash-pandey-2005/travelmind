import { Outlet } from "@tanstack/react-router";
import { useCurrentUser } from "../auth/useCurrentUser";
import { useLogout } from "../auth/useLogout";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ThemeToggle } from "../ui/ThemeToggle";
import { NavRail } from "./NavRail";
import { StatusBar } from "./StatusBar";

export function AppShell() {
  const me = useCurrentUser();
  const logout = useLogout();
  if (!me) return null;
  return (
    <div className="tm-grid tm-scanlines grid h-dvh grid-cols-[4.5rem_1fr] grid-rows-[3.5rem_1fr_2rem] lg:grid-cols-[14rem_1fr]">
      <NavRail />
      <header className="col-start-2 flex items-center justify-between gap-4 border-b border-line bg-deck/80 px-4 backdrop-blur">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-dim">Agency</p>
          <p className="truncate font-display text-sm tracking-wide text-ink">{me.agency.name}</p>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <div className="hidden items-center gap-2 sm:flex">
            <span className="text-sm text-ink">{me.user.full_name}</span>
            <Badge tone={me.user.role === "agent" ? "neutral" : "primary"}>{me.user.role}</Badge>
          </div>
          <Button variant="ghost" size="sm" loading={logout.isPending} onClick={() => logout.mutate()}>
            Sign out
          </Button>
        </div>
      </header>
      <main id="main" className="col-start-2 overflow-auto p-4 lg:p-6">
        <Outlet />
      </main>
      <StatusBar />
    </div>
  );
}
