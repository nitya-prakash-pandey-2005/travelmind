import { useQuery } from "@tanstack/react-query";
import { Route } from "lucide-react";
import { useMemo } from "react";
import { routeEnquiriesQueryOptions } from "../../api/dashboard";
import { formatNumber } from "../../lib/format";
import { EmptyState } from "../../ui/EmptyState";
import { cn } from "../../ui/cn";
import { GlobePanel } from "../globe/GlobePanel";
import { routeArcs, summariseRoutes } from "../globe/routeArcs";
import { useAirports } from "../globe/useAirports";
import { useRouteSelection } from "../route/routeStore";
import { routeLabel } from "./format";
import { ErrorPanel } from "./PanelError";
import { LoadingPanel } from "./panelParts";

const TITLE = "Route map";
const DESCRIPTION = "Routes from your enquiries; won and plotted routes highlighted";
const LISTED_ROUTES = 6;
/** Arcs drawn at most: the busiest routes (each needs its airports looked up). */
const GLOBE_ROUTES = 12;

/** Line-swatch legend for the map: identity is never colour alone, the words say what each line means. */
function Legend() {
  return (
    <ul aria-label="Map legend" className="flex items-center gap-3 text-[11px] text-dim">
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="h-px w-4 bg-primary" />
        Won or plotted
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="h-px w-4 bg-faint" />
        Other
      </li>
    </ul>
  );
}

export function RouteMapPanel({ onNewEnquiry, className }: { onNewEnquiry: () => void; className?: string }) {
  const enquiries = useQuery(routeEnquiriesQueryOptions);
  const selection = useRouteSelection();
  const routes = useMemo(() => summariseRoutes(enquiries.data?.items ?? []), [enquiries.data]);
  const drawn = useMemo(() => routes.slice(0, GLOBE_ROUTES), [routes]);
  const codes = useMemo(() => [...new Set(drawn.flatMap((r) => [r.origin, r.destination]))].sort(), [drawn]);
  const airports = useAirports(codes);
  const arcs = useMemo(() => routeArcs(drawn, airports, selection), [drawn, airports, selection]);

  if (enquiries.isPending) return <LoadingPanel title={TITLE} description={DESCRIPTION} rows={8} className={className} />;
  if (enquiries.isError) {
    return (
      <ErrorPanel
        title={TITLE}
        description={DESCRIPTION}
        error={enquiries.error}
        onRetry={() => void enquiries.refetch()}
        retrying={enquiries.isFetching}
        className={className}
      />
    );
  }

  const won = routes.filter((r) => r.won).length;

  return (
    <GlobePanel
      arcs={arcs}
      title={TITLE}
      description={DESCRIPTION}
      className={className}
      actions={routes.length > 0 && <Legend />}
    >
      {routes.length === 0 ? (
        <EmptyState
          icon={Route}
          className="py-4"
          title="No enquiry routes yet"
          description="Each enquiry's route is drawn on the map; won trips are highlighted."
          action={{ label: "Create enquiry", onClick: onNewEnquiry }}
        />
      ) : (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-2 flex items-baseline justify-between gap-3">
            <span aria-hidden="true" className="tm-micro">
              Busiest routes
            </span>
            <span className="font-mono text-[11px] tabular-nums text-faint">
              {formatNumber(routes.length)} {routes.length === 1 ? "route" : "routes"}, {formatNumber(won)} won
            </span>
          </p>
          <ul aria-label="Busiest routes" className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
            {routes.slice(0, LISTED_ROUTES).map((route) => (
              <li
                key={`${route.origin}-${route.destination}`}
                className="flex items-center justify-between gap-2 border-b border-line/60 py-1.5 font-mono text-xs"
              >
                <span className="flex min-w-0 items-center gap-1.5 text-ink">
                  <span aria-hidden="true" className={cn("h-px w-2.5 shrink-0", route.won ? "bg-primary" : "bg-faint")} />
                  <span className="truncate">{routeLabel(route.origin, route.destination)}</span>
                </span>
                <span className="tabular-nums text-dim">
                  {formatNumber(route.count)}
                  <span className="sr-only">
                    {" "}
                    {route.count === 1 ? "enquiry" : "enquiries"}
                    {route.won ? ", won" : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </GlobePanel>
  );
}
