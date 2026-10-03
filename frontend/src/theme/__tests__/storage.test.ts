import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_CHOICE, LEGACY_STORAGE_KEY, readChoice, STORAGE_KEY, writeChoice } from "../storage";
import { getThemeChoice, initTheme, setThemeChoice } from "../store";

beforeEach(() => {
  window.localStorage.clear();
});

describe("readChoice", () => {
  test("defaults to Orbital dark when nothing is saved", () => {
    expect(readChoice()).toEqual({ theme: "orbital", mode: "dark", contrast: false });
    expect(DEFAULT_CHOICE).toEqual({ theme: "orbital", mode: "dark", contrast: false });
  });

  test("reads a saved choice", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: "ember", mode: "light", contrast: true }));
    expect(readChoice()).toEqual({ theme: "ember", mode: "light", contrast: true });
  });

  test("repairs bad fields and ignores junk", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: "nebula", mode: "sepia", contrast: "yes" }));
    expect(readChoice()).toEqual({ theme: "nebula", mode: "dark", contrast: false });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: "neon", mode: "light" }));
    expect(readChoice()).toEqual(DEFAULT_CHOICE);
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    expect(readChoice()).toEqual(DEFAULT_CHOICE);
    window.localStorage.setItem(STORAGE_KEY, "null");
    expect(readChoice()).toEqual(DEFAULT_CHOICE);
  });

  test("migrates the old dark/daylight value to Orbital and drops the old key", () => {
    window.localStorage.setItem(LEGACY_STORAGE_KEY, "daylight");
    expect(readChoice()).toEqual({ theme: "orbital", mode: "light", contrast: false });
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual({ theme: "orbital", mode: "light", contrast: false });
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();

    window.localStorage.clear();
    window.localStorage.setItem(LEGACY_STORAGE_KEY, "dark");
    expect(readChoice()).toEqual({ theme: "orbital", mode: "dark", contrast: false });
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });

  test("a saved new-style choice wins over a leftover old value", () => {
    window.localStorage.setItem(LEGACY_STORAGE_KEY, "daylight");
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: "nebula", mode: "dark", contrast: false }));
    expect(readChoice()).toEqual({ theme: "nebula", mode: "dark", contrast: false });
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });

  test("an unknown old value falls back to the default", () => {
    window.localStorage.setItem(LEGACY_STORAGE_KEY, "neon");
    expect(readChoice()).toEqual(DEFAULT_CHOICE);
  });
});

describe("blocked storage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("reading falls back to the default when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readChoice()).toEqual(DEFAULT_CHOICE);
  });

  test("reading survives localStorage itself being inaccessible", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readChoice()).toEqual(DEFAULT_CHOICE);
    expect(() => writeChoice({ theme: "nebula", mode: "dark", contrast: false })).not.toThrow();
  });

  test("writing swallows quota and privacy errors", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => writeChoice({ theme: "nebula", mode: "dark", contrast: false })).not.toThrow();
  });

  test("the theme still switches for this session when storage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    initTheme();
    setThemeChoice({ theme: "ember" });
    expect(getThemeChoice().theme).toBe("ember");
    expect(document.documentElement.dataset.theme).toBe("ember");
  });
});

describe("theme store", () => {
  beforeEach(() => {
    initTheme();
  });

  test("initTheme applies the saved choice to <html>", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: "nebula", mode: "light", contrast: true }));
    expect(initTheme()).toEqual({ theme: "nebula", mode: "light", contrast: true });
    const { dataset } = document.documentElement;
    expect([dataset.theme, dataset.mode, dataset.contrast]).toEqual(["nebula", "light", "high"]);
  });

  test("a change is applied and remembered across reloads", () => {
    setThemeChoice({ theme: "ember", mode: "light" });
    expect(document.documentElement.dataset.theme).toBe("ember");
    expect(document.documentElement.dataset.mode).toBe("light");
    expect(initTheme()).toEqual({ theme: "ember", mode: "light", contrast: false });
  });

  test("fixed themes ignore mode and contrast changes", () => {
    setThemeChoice({ theme: "terminal" });
    expect(getThemeChoice()).toEqual({ theme: "terminal", mode: "dark", contrast: false });
    setThemeChoice({ mode: "light", contrast: true });
    expect(getThemeChoice()).toEqual({ theme: "terminal", mode: "dark", contrast: false });
    expect(document.documentElement.dataset.mode).toBe("dark");
    expect(document.documentElement.dataset.contrast).toBe("normal");

    setThemeChoice({ theme: "clearsky" });
    expect(getThemeChoice()).toEqual({ theme: "clearsky", mode: "light", contrast: false });
  });

  test("leaving a fixed theme restores the viewer's own mode and contrast", () => {
    setThemeChoice({ theme: "orbital", mode: "dark", contrast: true });
    setThemeChoice({ theme: "clearsky" });
    expect(getThemeChoice().mode).toBe("light");
    setThemeChoice({ theme: "nebula" });
    expect(getThemeChoice()).toEqual({ theme: "nebula", mode: "dark", contrast: true });
  });

  test("a saved fixed theme loads in its own look", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: "clearsky", mode: "dark", contrast: true }));
    expect(initTheme()).toEqual({ theme: "clearsky", mode: "light", contrast: false });
    expect(document.documentElement.dataset.mode).toBe("light");
  });
});
