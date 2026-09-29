import { renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { AIRPORTS } from "../../test/fixtures";
import { midpoint } from "../route/geo";
import { useFlyToActiveRoute } from "./useFlyToActiveRoute";

const mid = midpoint(AIRPORTS.DEL, AIRPORTS.BOM);

function setup(initial: { ready: boolean; reducedMotion?: boolean }) {
  const globeRef = { current: { pointOfView: vi.fn() } };
  const hook = renderHook(
    ({ active, ready, reducedMotion }) => useFlyToActiveRoute(globeRef, active, ready, reducedMotion),
    {
      initialProps: {
        active: { from: AIRPORTS.DEL, to: AIRPORTS.BOM } as { from: typeof AIRPORTS.DEL; to: typeof AIRPORTS.BOM } | undefined,
        ready: initial.ready,
        reducedMotion: initial.reducedMotion ?? false,
      },
    },
  );
  return { pointOfView: globeRef.current.pointOfView, ...hook };
}

test("flies to a route that was already active once the globe becomes ready", () => {
  const { pointOfView, rerender } = setup({ ready: false });
  expect(pointOfView).not.toHaveBeenCalled();
  rerender({ active: { from: AIRPORTS.DEL, to: AIRPORTS.BOM }, ready: true, reducedMotion: false });
  expect(pointOfView).toHaveBeenCalledTimes(1);
  expect(pointOfView).toHaveBeenCalledWith({ lat: mid.lat, lng: mid.lng, altitude: 1.9 }, 1200);
});

test("does not fly again when the same pair arrives as new objects", () => {
  const { pointOfView, rerender } = setup({ ready: true });
  expect(pointOfView).toHaveBeenCalledTimes(1);
  rerender({ active: { from: { ...AIRPORTS.DEL }, to: { ...AIRPORTS.BOM } }, ready: true, reducedMotion: false });
  expect(pointOfView).toHaveBeenCalledTimes(1);
});

test("flies to a newly selected route", () => {
  const { pointOfView, rerender } = setup({ ready: true });
  rerender({ active: { from: AIRPORTS.LHR, to: AIRPORTS.JFK }, ready: true, reducedMotion: false });
  expect(pointOfView).toHaveBeenCalledTimes(2);
  const next = midpoint(AIRPORTS.LHR, AIRPORTS.JFK);
  expect(pointOfView).toHaveBeenLastCalledWith({ lat: next.lat, lng: next.lng, altitude: 1.9 }, 1200);
});

test("reduced motion jumps without a camera flight", () => {
  const { pointOfView } = setup({ ready: true, reducedMotion: true });
  expect(pointOfView).toHaveBeenCalledWith({ lat: mid.lat, lng: mid.lng, altitude: 1.9 }, 0);
});

test("stays put without an active route", () => {
  const { pointOfView, rerender } = setup({ ready: false });
  rerender({ active: undefined, ready: true, reducedMotion: false });
  expect(pointOfView).not.toHaveBeenCalled();
});
