import { useQueries, useQuery } from "@tanstack/react-query";
import { Route } from "lucide-react";
import { useCallback, useMemo } from "react";
import { routeEnquiriesQueryOptions } from "../../api/dashboard";
import { airportSearchQueryOptions } from "../../api/queries";
import type { Airport } from "../../api/types";
import { formatNumber } from "../../lib/format";
import { EmptyState } from "../../ui/EmptyState";
import { PanelSkeleton } from "../../ui/Skeleton";
import { cn } from "../../ui/cn";
import { GlobePanel } from "../globe/GlobePanel";
import { routeArcs, summariseRoutes } from "../globe/routeArcs";
import { useRouteSelection } from "../route/routeStore";
import { routeLabel } from "./format";
import { ErrorPanel } from "./PanelError";

const TITLE = "Route globe";
const EYEBROW = "Enquiry routes";
const LISTED_ROUTES = 6;
/** Arcs drawn at most: the busiest routes (each needs its airports looked up). */
const GLOBE_ROUTES = 12;

/** Airports by code, looked up through the (cached) airport search: an exact code match only. */
function useAirports(codes: readonly string[]): Map<string, Airport> {
  const combine = useCallback(
    (results: { data?: Airport[] }[]) => results.map((result, index) => result.data?.find((a) => a.iata_code === codes[index]) ?? null),
    [codes],
  );
  // The combined list is structurally shared, so it keeps its identity until an airport resolves.
  const found = useQueries({ queries: codes.map((code) => airportSearchQueryOptions(code)), combine });
  return useMemo(() => new Map(found.flatMap((a) => (a ? [[a.iata_code, a] as const] : []))), [found]);
}

export function RouteMapPanel({ onNewEnquiry, className }: { onNewEnquiry: () => void; className?: string }) {
  const enquiries = useQuery(routeEnquiriesQueryOptions);
  const selection = useRouteSelection();
  const routes = useMemo(() => summariseRoutes(enquiries.data?.items ?? []), [enquiries.data]);
  const drawn = useMemo(() => routes.slice(0, GLOBE_ROUTES), [routes]);
  const codes = useMemo(() => [...new Set(drawn.flatMap((r) => [r.origin, r.destination]))].sort(), [drawn]);
  const airports = useAirports(codes);
  const arcs = useMemo(() => routeArcs(drawn, airports, selection), [drawn, airports, selection]);

  if (enquiries.isPending) return <PanelSkeleton title={TITLE} eyebrow={EYEBROW} className={className} />;
  if (enquiries.isError) {
    return (
      <ErrorPanel
        title={TITLE}
        eyebrow={EYEBROW}
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
      eyebrow={EYEBROW}
      variant="glass"
      className={cn("h-full", className)}
      actions={
        routes.length > 0 && (
          <p className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.16em] text-dim">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-1.5 w-3 rounded-full bg-primary" />
              {formatNumber(won)} won
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-1.5 w-3 rounded-full bg-dim" />
              {formatNumber(routes.length)} {routes.length === 1 ? "route" : "routes"}
            </span>
          </p>
        )
      }
    >
      {routes.length === 0 ? (
        <EmptyState
          icon={Route}
          className="py-4"
          title="No enquiry routes yet"
          description="Routes from your enquiries arc across the globe; won trips glow."
          action={{ label: "Create an enquiry", onClick: onNewEnquiry }}
        />
      ) : (
        <ul aria-label="Busiest routes" className="mt-3 flex flex-wrap gap-1.5">
          {routes.slice(0, LISTED_ROUTES).map((route) => (
            <li
              key={`${route.origin}-${route.destination}`}
              className={cn(
                "tm-tint inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono text-xs",
                route.won ? "text-primary" : "text-dim",
              )}
            >
              <span className="text-ink">{routeLabel(route.origin, route.destination)}</span>
              <span>×{formatNumber(route.count)}</span>
              {route.won && <span className="sr-only">(won)</span>}
            </li>
          ))}
        </ul>
      )}
    </GlobePanel>
  );
}
