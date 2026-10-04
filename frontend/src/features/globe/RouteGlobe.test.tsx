import { act, render } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AIRPORTS } from "../../test/fixtures";
import type { GlobeArc } from "./RouteGlobe";

// The real globe needs WebGL. This stand-in exposes the methods RouteGlobe calls, with the two under test spied.
const globe = vi.hoisted(() => ({
  pauseAnimation: vi.fn(),
  resumeAnimation: vi.fn(),
}));

vi.mock("react-globe.gl", () => ({
  default: forwardRef(function FakeGlobe(_props: object, ref) {
    useImperativeHandle(ref, () => ({
      ...globe,
      controls: () => ({}),
      pointOfView: () => ({ lat: 0, lng: 0, altitude: 2 }),
      scene: () => ({ add: () => {}, remove: () => {} }),
      camera: () => ({ position: { length: () => 300 } }),
      getCoords: () => ({ x: 0, y: 0, z: 100 }),
    }));
    return <div data-testid="globe" />;
  }),
}));
// jsdom has no layout: give the container a size so the globe mounts.
vi.mock("../../lib/useElementSize", () => ({
  useElementSize: () => [() => {}, { width: 600, height: 400 }],
}));

type Callback = (entries: Array<{ isIntersecting: boolean }>) => void;
let report: Callback = () => {};

class FakeObserver {
  constructor(callback: Callback) {
    report = callback;
  }
  observe() {}
  disconnect() {}
}

const { default: RouteGlobe } = await import("./RouteGlobe");
const ARCS: GlobeArc[] = [{ from: AIRPORTS.DEL, to: AIRPORTS.BOM, active: true }];

beforeEach(() => {
  globe.pauseAnimation.mockClear();
  globe.resumeAnimation.mockClear();
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("pauses the globe's render loop off screen and resumes it when scrolled back", () => {
  render(<RouteGlobe arcs={ARCS} />);
  expect(globe.resumeAnimation).toHaveBeenCalled();
  expect(globe.pauseAnimation).not.toHaveBeenCalled();

  act(() => report([{ isIntersecting: false }]));
  expect(globe.pauseAnimation).toHaveBeenCalledTimes(1);

  globe.resumeAnimation.mockClear();
  act(() => report([{ isIntersecting: true }]));
  expect(globe.resumeAnimation).toHaveBeenCalledTimes(1);
});

test("pauses while the tab is hidden", () => {
  let state: DocumentVisibilityState = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => state);
  render(<RouteGlobe arcs={ARCS} />);
  state = "hidden";
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(globe.pauseAnimation).toHaveBeenCalledTimes(1);
});
