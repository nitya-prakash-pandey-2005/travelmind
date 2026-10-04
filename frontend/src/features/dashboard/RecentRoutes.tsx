import { useId } from "react";
import { formatNumber } from "../../lib/format";
import { greatCircleKm } from "../route/geo";
import type { RecentRoute } from "../route/recentRoutes";

/**
 * Routes plotted recently on this device, newest first, as a compact list inside the route planner card.
 * Clicking one plots it again.
 */
export function RecentRoutes({ routes, onSelect }: { routes: RecentRoute[]; onSelect: (route: RecentRoute) => void }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId}>
      <h3 id={titleId} className="tm-micro mb-1.5">
        Recent routes
      </h3>
      {routes.length === 0 ? (
        <p className="text-xs text-dim">Routes you plot are kept here so you can plot them again in one click.</p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {routes.map((route) => (
            <li key={`${route.origin.iata_code}-${route.destination.iata_code}`}>
              <button
                type="button"
                onClick={() => onSelect(route)}
                className="flex h-8 w-full items-center justify-between gap-3 rounded-md px-2 text-left transition-colors duration-150 ease-tm hover:bg-hover"
              >
                <span className="font-mono text-[13px] text-ink">
                  {route.origin.iata_code} → {route.destination.iata_code}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-dim">
                  {formatNumber(Math.round(greatCircleKm(route.origin, route.destination)))} km
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
