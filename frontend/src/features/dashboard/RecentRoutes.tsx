import { History } from "lucide-react";
import { formatNumber } from "../../lib/format";
import { EmptyState } from "../../ui/EmptyState";
import { Panel, type PanelVariant } from "../../ui/Panel";
import { greatCircleKm } from "../route/geo";
import type { RecentRoute } from "../route/recentRoutes";

export function RecentRoutesPanel({
  routes,
  onSelect,
  variant,
  className,
}: {
  routes: RecentRoute[];
  onSelect: (route: RecentRoute) => void;
  variant?: PanelVariant;
  className?: string;
}) {
  return (
    <Panel eyebrow="Log" title="Recent routes" variant={variant} className={className}>
      {routes.length === 0 ? (
        <EmptyState
          icon={History}
          className="py-6"
          title="No routes scanned yet"
          description="Routes you plot with the route scanner are kept here for one-click replay."
        />
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
