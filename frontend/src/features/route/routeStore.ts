import { useSyncExternalStore } from "react";
import type { Airport } from "../../api/types";

export type RouteSelection = { origin: Airport | null; destination: Airport | null };

const EMPTY: RouteSelection = { origin: null, destination: null };
let state: RouteSelection = EMPTY;
const listeners = new Set<() => void>();

function emit(next: RouteSelection): void {
  state = next;
  listeners.forEach((listener) => listener());
}

/** The route being scanned, shared by the scanner, the globe and the command palette. */
export const routeStore = {
  get: (): RouteSelection => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  setOrigin(origin: Airport | null): void {
    emit({ ...state, origin });
  },
  setDestination(destination: Airport | null): void {
    emit({ ...state, destination });
  },
  /** Fill origin first, then destination; with both set, replace the destination. */
  place(airport: Airport): void {
    emit(state.origin ? { ...state, destination: airport } : { ...state, origin: airport });
  },
  swap(): void {
    emit({ origin: state.destination, destination: state.origin });
  },
  set(next: RouteSelection): void {
    emit(next);
  },
  reset(): void {
    emit(EMPTY);
  },
};

export function useRouteSelection(): RouteSelection {
  return useSyncExternalStore(routeStore.subscribe, routeStore.get, routeStore.get);
}
