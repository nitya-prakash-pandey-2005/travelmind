import { ArrowUpDown, type LucideIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import type { Airport } from "../../api/types";
import { formatDuration, formatNumber } from "../../lib/format";
import { Button } from "../../ui/Button";
import { Panel } from "../../ui/Panel";
import { Readout } from "../../ui/Readout";
import { AirportPicker } from "../airports/AirportPicker";
import { CRUISE_KMH, KM_PER_NMI, TAXI_CLIMB_DESCENT_MIN, estimateFlightMinutes, greatCircleKm } from "./geo";
import { routeStore, useRouteSelection } from "./routeStore";

/**
 * Route planner: pick two airports to see the great-circle distance and an estimated flight time, draw the
 * route on the map, and (when the page offers it) jump to a fare search. `children` render under a hairline
 * at the bottom of the card (the recent-routes list on the Command Center).
 */
export function RouteScanner({
  onRouteReady,
  onScanFares,
  icon,
  className,
  children,
}: {
  onRouteReady?: (origin: Airport, destination: Airport) => void;
  onScanFares?: () => void;
  /** The kit's icon chip in the card head. */
  icon?: LucideIcon;
  className?: string;
  children?: ReactNode;
}) {
  const { origin, destination } = useRouteSelection();
  const sameAirport = origin !== null && destination !== null && origin.iata_code === destination.iata_code;
  const km = origin && destination && !sameAirport ? greatCircleKm(origin, destination) : null;

  // Report each ready pair once, even if the callback identity or airport objects change between renders.
  const lastReported = useRef<string | null>(null);
  useEffect(() => {
    if (!origin || !destination || origin.iata_code === destination.iata_code) {
      lastReported.current = null;
      return;
    }
    const pair = `${origin.iata_code}-${destination.iata_code}`;
    if (pair === lastReported.current) return;
    lastReported.current = pair;
    onRouteReady?.(origin, destination);
  }, [origin, destination, onRouteReady]);

  return (
    <Panel
      title="Route planner"
      description="Distance and flight time between two airports"
      icon={icon}
      className={className}
      actions={
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="Swap origin and destination"
          disabled={!origin && !destination}
          onClick={() => routeStore.swap()}
        >
          <ArrowUpDown size={14} aria-hidden="true" />
        </Button>
      }
    >
      <div className="flex flex-col gap-2.5">
        <AirportPicker label="From" value={origin} onChange={(a) => routeStore.setOrigin(a)} />
        <AirportPicker label="To" value={destination} onChange={(a) => routeStore.setDestination(a)} />
      </div>
      {sameAirport && (
        <p role="alert" className="mt-3 text-[13px] text-warn">
          Pick two different airports.
        </p>
      )}
      {km !== null && (
        <dl className="mt-3 grid grid-cols-2 gap-3 rounded-[14px] border border-line bg-card-2 px-3.5 py-3">
          <Readout
            label="Great-circle distance"
            value={formatNumber(Math.round(km))}
            unit="km"
            hint={`${formatNumber(Math.round(km / KM_PER_NMI))} nmi`}
          />
          <Readout
            label="Est. flight time"
            value={formatDuration(estimateFlightMinutes(km))}
            hint={`Estimate at ${formatNumber(CRUISE_KMH)} km/h + ${TAXI_CLIMB_DESCENT_MIN} min`}
          />
        </dl>
      )}
      {km !== null && onScanFares && (
        <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={onScanFares}>
          Scan fares for this route
        </Button>
      )}
      {km === null && !sameAirport && <p className="mt-3 text-xs text-dim">Pick two airports to scan fares.</p>}
      {children && <div className="-mx-[18px] mt-4 border-t border-line px-[18px] pt-3">{children}</div>}
    </Panel>
  );
}
