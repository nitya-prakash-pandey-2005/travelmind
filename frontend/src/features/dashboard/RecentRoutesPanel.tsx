import { formatNumber } from "../../lib/format";
import { Panel } from "../../ui/Panel";
import { greatCircleKm } from "../route/geo";
import type { RecentRoute } from "../route/recentRoutes";

export function RecentRoutesPanel({ routes, onSelect }: { routes: RecentRoute[]; onSelect: (route: RecentRoute) => void }) {
  return (
    <Panel eyebrow="Log" title="Recent routes">
      {routes.length === 0 ? (
        <p className="text-sm text-dim">No routes scanned yet. Plot one with the route scanner.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {routes.map((route) => (
            <li key={`${route.origin.iata_code}-${route.destination.iata_code}`}>
              <button
                type="button"
                onClick={() => onSelect(route)}
                className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left transition hover:bg-raised"
              >
                <span className="font-mono text-sm text-ink">
                  {route.origin.iata_code} → {route.destination.iata_code}
                </span>
                <span className="font-mono text-xs text-dim">
                  {formatNumber(Math.round(greatCircleKm(route.origin, route.destination)))} km
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
