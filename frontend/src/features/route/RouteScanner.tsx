import { ArrowLeftRight } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Airport } from "../../api/types";
import { formatDuration, formatNumber } from "../../lib/format";
import { Button } from "../../ui/Button";
import { Panel } from "../../ui/Panel";
import { Readout } from "../../ui/Readout";
import { AirportPicker } from "../airports/AirportPicker";
import { CRUISE_KMH, KM_PER_NMI, TAXI_CLIMB_DESCENT_MIN, estimateFlightMinutes, greatCircleKm } from "./geo";
import { routeStore, useRouteSelection } from "./routeStore";

export function RouteScanner({
  onRouteReady,
  onScanFares,
}: {
  onRouteReady?: (origin: Airport, destination: Airport) => void;
  onScanFares?: () => void;
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
      eyebrow="Route scanner"
      title="Plot a route"
      actions={
        <Button
          variant="ghost"
          size="sm"
          aria-label="Swap origin and destination"
          disabled={!origin && !destination}
          onClick={() => routeStore.swap()}
        >
          <ArrowLeftRight size={14} aria-hidden="true" />
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <AirportPicker label="From" value={origin} onChange={(a) => routeStore.setOrigin(a)} />
        <AirportPicker label="To" value={destination} onChange={(a) => routeStore.setDestination(a)} />
      </div>
      {sameAirport && (
        <p role="alert" className="mt-3 text-sm text-warn">
          Pick two different airports.
        </p>
      )}
      {km !== null && (
        <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4">
          <Readout
            label="Great-circle distance"
            value={formatNumber(Math.round(km))}
            unit="km"
            hint={`${formatNumber(Math.round(km / KM_PER_NMI))} nmi`}
          />
          <Readout
            label="Est. flight time"
            value={formatDuration(estimateFlightMinutes(km))}
            hint={`Estimate · ${CRUISE_KMH} km/h cruise + ${TAXI_CLIMB_DESCENT_MIN} min`}
          />
        </dl>
      )}
      {km !== null && onScanFares && (
        <Button className="mt-4 w-full" onClick={onScanFares}>
          Scan fares for this route
        </Button>
      )}
      {km === null && <p className="mt-4 text-xs text-dim">Pick two airports to scan fares.</p>}
    </Panel>
  );
}
