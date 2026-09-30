import { Link } from "@tanstack/react-router";
import { BedDouble, Palette, Plane, PlugZap, Radar, Users } from "lucide-react";

const ITEMS = [
  { to: "/", label: "Mission Control", icon: Radar },
  { to: "/fares", label: "Fare scan", icon: Plane },
  { to: "/hotels", label: "Hotel scan", icon: BedDouble },
  { to: "/suppliers", label: "Suppliers", icon: PlugZap },
  { to: "/team", label: "Crew roster", icon: Users },
  { to: "/design", label: "Design system", icon: Palette },
] as const;

export function NavRail() {
  return (
    <aside className="row-span-3 flex flex-col border-r border-line bg-deck/80 backdrop-blur">
      <div className="flex h-14 items-center justify-center border-b border-line lg:justify-start lg:px-5">
        <span className="font-display text-sm tracking-[0.35em] text-primary">
          <span aria-hidden="true" className="lg:hidden">
            TM
          </span>
          <span className="sr-only lg:not-sr-only">TRAVELMIND</span>
        </span>
      </div>
      <nav aria-label="Primary" className="flex flex-col gap-1 p-2">
        {ITEMS.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            aria-label={label}
            activeOptions={{ exact: to === "/" }}
            className="flex h-10 items-center justify-center gap-3 rounded-sm px-3 text-dim transition hover:bg-raised hover:text-ink lg:justify-start"
            activeProps={{ className: "bg-raised text-primary" }}
          >
            <Icon size={18} aria-hidden="true" />
            <span className="sr-only font-display text-xs uppercase tracking-[0.18em] lg:not-sr-only">{label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
