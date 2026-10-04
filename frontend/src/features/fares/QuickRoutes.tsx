import { ArrowRight, Route } from "lucide-react";
import type { Airport } from "../../api/types";
import { formatNumber } from "../../lib/format";
import { cn } from "../../ui/cn";
import { Panel } from "../../ui/Panel";
import { greatCircleKm } from "../route/geo";
import type { RecentRoute } from "../route/recentRoutes";
import { routeStore, useRouteSelection } from "../route/routeStore";
import { POPULAR_ROUTES } from "./popularRoutes";
import { QuickGroup } from "./QuickGroup";

type Pair = { origin: Airport; destination: Airport };

/** Routes shown in all: recent searches first, popular routes fill the rest. */
const SLOTS = 8;

const place = (a: Airport) => a.city ?? a.name;
const keyOf = (p: Pair) => `${p.origin.iata_code}-${p.destination.iata_code}`;

/** Recent routes (at most SLOTS) and the popular routes that fill the remaining slots, without repeats. */
export function quickRoutes(recent: Pair[]): { recent: Pair[]; popular: Pair[] } {
  const mine = recent.slice(0, SLOTS);
  const taken = new Set(mine.map(keyOf));
  const popular = POPULAR_ROUTES.filter((p) => !taken.has(keyOf(p))).slice(0, SLOTS - mine.length);
  return { recent: mine, popular };
}

function RouteChip({ pair, active }: { pair: Pair; active: boolean }) {
  const { origin, destination } = pair;
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${origin.iata_code} to ${destination.iata_code}, ${place(origin)} to ${place(destination)}`}
      onClick={() => routeStore.set({ origin, destination })}
      className={cn(
        "flex w-full min-w-0 flex-col gap-1 rounded-[14px] border px-3 py-2.5 text-left transition-colors duration-150 ease-tm",
        active ? "border-primary bg-[image:var(--grad-soft)]" : "border-line bg-card-2 hover:border-line-strong",
      )}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-mono text-[13px] font-medium text-ink">
          {origin.iata_code}
          <ArrowRight size={12} aria-hidden="true" className="text-faint" />
          {destination.iata_code}
        </span>
        <span className="tm-num text-[11px] text-dim">{formatNumber(Math.round(greatCircleKm(origin, destination)))} km</span>
      </span>
      <span className="truncate text-xs leading-4 text-dim">
        {place(origin)} – {place(destination)}
      </span>
    </button>
  );
}

/**
 * One-click routes for the fare search bar: this user's recent searches, newest first, then busy real routes
 * (labelled as suggestions) to fill the panel. Picking one fills From and To; it doesn't search.
 */
export function QuickRoutes({ recent }: { recent: RecentRoute[] }) {
  const selected = useRouteSelection();
  const groups = quickRoutes(recent);
  const isActive = (p: Pair) =>
    selected.origin?.iata_code === p.origin.iata_code && selected.destination?.iata_code === p.destination.iata_code;
  const chip = (p: Pair) => <RouteChip pair={p} active={isActive(p)} />;
  return (
    <Panel title="Quick routes" icon={Route} description="Pick one to fill From and To, then scan.">
      <div className="flex flex-col gap-4">
        <QuickGroup title="Your recent searches" items={groups.recent} keyOf={keyOf} render={chip} />
        <QuickGroup
          title="Popular routes"
          note="Suggested busy routes, not from your searches"
          items={groups.popular}
          keyOf={keyOf}
          render={chip}
        />
      </div>
    </Panel>
  );
}
