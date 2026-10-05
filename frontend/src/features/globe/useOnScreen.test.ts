import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useOnScreen } from "./useOnScreen";

type Callback = (entries: Array<{ isIntersecting: boolean }>) => void;

/** A stand-in IntersectionObserver whose callback the test drives. */
class FakeObserver {
  static latest: FakeObserver | null = null;
  observed: Element[] = [];
  disconnected = false;
  constructor(readonly callback: Callback) {
    FakeObserver.latest = this;
  }
  observe(node: Element) {
    this.observed.push(node);
  }
  disconnect() {
    this.disconnected = true;
  }
  report(isIntersecting: boolean) {
    act(() => this.callback([{ isIntersecting }]));
  }
}

let visibility: DocumentVisibilityState = "visible";

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => {
  FakeObserver.latest = null;
  visibility = "visible";
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("is on screen until the observer says the element left the viewport, and again when it returns", () => {
  const node = document.createElement("div");
  const { result } = renderHook(() => useOnScreen(node));
  expect(result.current).toBe(true);
  expect(FakeObserver.latest?.observed).toEqual([node]);

  FakeObserver.latest?.report(false);
  expect(result.current).toBe(false);
  FakeObserver.latest?.report(true);
  expect(result.current).toBe(true);
});

test("counts a hidden tab as off screen", () => {
  const node = document.createElement("div");
  const { result } = renderHook(() => useOnScreen(node));
  setVisibility("hidden");
  expect(result.current).toBe(false);
  setVisibility("visible");
  expect(result.current).toBe(true);
});

test("starts off screen in a tab that is already hidden", () => {
  visibility = "hidden";
  const { result } = renderHook(() => useOnScreen(document.createElement("div")));
  expect(result.current).toBe(false);
});

test("stops observing when the element goes away", () => {
  const { unmount } = renderHook(() => useOnScreen(document.createElement("div")));
  const observer = FakeObserver.latest;
  unmount();
  expect(observer?.disconnected).toBe(true);
});

test("without IntersectionObserver the element counts as on screen", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  const { result } = renderHook(() => useOnScreen(document.createElement("div")));
  expect(result.current).toBe(true);
});
