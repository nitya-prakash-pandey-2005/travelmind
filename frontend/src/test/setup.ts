import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { initTheme } from "../theme";

// The first render in a file pays for lazy imports; under a full parallel run that can pass the
// 1 s default for findBy*/waitFor, so allow more time before an async lookup fails.
configure({ asyncUtilTimeout: 4000 });

// jsdom lacks these browser APIs; components use them for motion, layout and list scrolling.
if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= function scrollIntoView() {};
// jsdom defines scrollTo but only logs "Not implemented"; the router calls it on navigation.
window.scrollTo = (() => {}) as typeof window.scrollTo;
// jsdom has no canvas: getContext returns null after logging "Not implemented". Return null quietly
// so the WebGL probe sees "no WebGL", exactly as on a device without it.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
// jsdom has <dialog> but not its modal API: opening sets `open`; closing clears it and fires "close".
if (typeof HTMLDialogElement.prototype.showModal !== "function") {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
}
if (typeof HTMLDialogElement.prototype.show !== "function") {
  HTMLDialogElement.prototype.show = function show(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
}
if (typeof HTMLDialogElement.prototype.close !== "function") {
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement, returnValue?: string) {
    if (!this.hasAttribute("open")) return;
    if (returnValue !== undefined) this.returnValue = returnValue;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  try {
    window.localStorage.clear();
  } catch {
    // storage unavailable in this environment
  }
  // Back to the default look (storage is empty now), so no test inherits another's theme.
  initTheme();
});
