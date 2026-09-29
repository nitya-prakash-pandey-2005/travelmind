import { useMemo } from "react";
import { useCurrentUser } from "../../auth/useCurrentUser";
import { GlobePanel } from "../globe/GlobePanel";
import type { GlobeArc } from "../globe/RouteGlobe";
import { RouteScanner } from "../route/RouteScanner";
import { useRecentRoutes } from "../route/recentRoutes";
import { routeStore, useRouteSelection } from "../route/routeStore";
import { AgencyPanel } from "./AgencyPanel";
import { RecentRoutesPanel } from "./RecentRoutesPanel";

export function MissionControlPage() {
  const me = useCurrentUser();
  const selection = useRouteSelection();
  const { routes, record } = useRecentRoutes(me?.user.id ?? "anonymous");

  const arcs = useMemo<GlobeArc[]>(() => {
    const history = routes.map((r) => ({ from: r.origin, to: r.destination, active: false }));
    const { origin, destination } = selection;
    if (!origin || !destination || origin.iata_code === destination.iata_code) return history;
    const isCurrent = (a: GlobeArc) =>
      a.from.iata_code === origin.iata_code && a.to.iata_code === destination.iata_code;
    return [{ from: origin, to: destination, active: true }, ...history.filter((a) => !isCurrent(a))];
  }, [routes, selection]);

  if (!me) return null;
  const firstName = me.user.full_name.split(" ")[0] ?? me.user.full_name;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex min-h-0 flex-col gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">Mission Control</p>
          <h1 className="font-display text-2xl tracking-wide text-ink">Welcome aboard, {firstName}</h1>
        </div>
        <GlobePanel arcs={arcs} />
      </div>
      <div className="flex flex-col gap-4">
        <RouteScanner onRouteReady={record} />
        <RecentRoutesPanel
          routes={routes}
          onSelect={(route) => routeStore.set({ origin: route.origin, destination: route.destination })}
        />
        <AgencyPanel me={me} />
      </div>
    </div>
  );
}
