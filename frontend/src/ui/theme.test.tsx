import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { ThemeToggle } from "./ThemeToggle";
import { getTheme, initTheme, setTheme } from "./theme";

beforeEach(() => {
  window.localStorage.clear();
  initTheme();
});

test("defaults to the dark theme", () => {
  expect(initTheme()).toBe("dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
});

test("remembers the chosen theme across reloads", () => {
  setTheme("daylight");
  expect(document.documentElement.dataset.theme).toBe("daylight");
  expect(initTheme()).toBe("daylight");
});

test("ignores junk stored values", () => {
  window.localStorage.setItem("tm-theme", "neon");
  expect(initTheme()).toBe("dark");
});

test("still switches theme when storage throws", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("QuotaExceededError");
  });
  setTheme("daylight");
  expect(getTheme()).toBe("daylight");
  expect(document.documentElement.dataset.theme).toBe("daylight");
});

test("ThemeToggle flips the theme and updates its label", async () => {
  render(<ThemeToggle />);
  await userEvent.click(screen.getByRole("button", { name: "Switch to daylight theme" }));
  expect(document.documentElement.dataset.theme).toBe("daylight");
  expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeInTheDocument();
});
