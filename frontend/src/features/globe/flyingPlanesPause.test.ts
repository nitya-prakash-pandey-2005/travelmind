import { renderHook } from "@testing-library/react";
import type { GlobeMethods } from "react-globe.gl";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AIRPORTS } from "../../test/fixtures";
import { useFlyingPlanes } from "./flyingPlanes";
import type { GlobeArc } from "./RouteGlobe";

const ARCS: GlobeArc[] = [{ from: AIRPORTS.DEL, to: AIRPORTS.BOM, active: true }];

/** Just enough of a globe for the planes: a scene to hold the sprites, a camera and coordinates. */
function fakeGlobe() {
  const scene = { add: vi.fn(), remove: vi.fn() };
  const globe = {
    scene: () => scene,
    camera: () => ({ position: { length: () => 300 } }),
    getCoords: () => ({ x: 0, y: 0, z: 100 }),
  };
  return { ref: { current: globe as unknown as GlobeMethods }, scene };
}

let frames: ReturnType<typeof vi.spyOn>;
let cancels: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Frames are requested but never run, so nothing needs a real camera.
  frames = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 7);
  cancels = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("paused planes request no animation frames and add nothing to the scene", () => {
  const { ref, scene } = fakeGlobe();
  renderHook(() => useFlyingPlanes(ref, ARCS, "#fff", true, false, 0.45, true));
  expect(frames).not.toHaveBeenCalled();
  expect(scene.add).not.toHaveBeenCalled();
});

test("pausing stops the loop and takes the planes out; resuming flies them again", () => {
  const { ref, scene } = fakeGlobe();
  const { rerender } = renderHook(({ paused }) => useFlyingPlanes(ref, ARCS, "#fff", true, false, 0.45, paused), {
    initialProps: { paused: false },
  });
  expect(frames).toHaveBeenCalledTimes(1);
  expect(scene.add).toHaveBeenCalledTimes(1);

  rerender({ paused: true });
  expect(cancels).toHaveBeenCalledWith(7);
  expect(scene.remove).toHaveBeenCalledTimes(1);
  expect(frames).toHaveBeenCalledTimes(1);

  rerender({ paused: false });
  expect(frames).toHaveBeenCalledTimes(2);
  expect(scene.add).toHaveBeenCalledTimes(2);
});
