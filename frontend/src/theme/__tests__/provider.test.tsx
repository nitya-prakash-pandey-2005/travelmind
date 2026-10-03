import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { ThemeToggle } from "../../ui/ThemeToggle";
import { resolvePalette } from "../palettes";
import { STORAGE_KEY } from "../storage";
import { initTheme, setThemeChoice, useThemeChoice } from "../store";
import { ThemeProvider } from "../ThemeProvider";
import { useThemePalette } from "../useThemePalette";

beforeEach(() => {
  window.localStorage.clear();
  initTheme();
});

function attributes() {
  const { dataset } = document.documentElement;
  return { theme: dataset.theme, mode: dataset.mode, contrast: dataset.contrast };
}

function ChoiceProbe() {
  const [choice, setChoice] = useThemeChoice();
  return (
    <div>
      <output aria-label="choice">{`${choice.theme} ${choice.mode} ${choice.contrast ? "high" : "normal"}`}</output>
      <button type="button" onClick={() => setChoice({ theme: "nebula" })}>
        Nebula
      </button>
      <button type="button" onClick={() => setChoice({ mode: "light" })}>
        Light
      </button>
      <button type="button" onClick={() => setChoice({ contrast: true })}>
        High contrast
      </button>
    </div>
  );
}

function PaletteProbe() {
  const palette = useThemePalette();
  return <output aria-label="primary">{palette.primary}</output>;
}

test("initTheme (run once by main.tsx) puts the saved choice and colour scheme on <html>", () => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: "ember", mode: "light", contrast: true }));
  document.documentElement.removeAttribute("data-theme");
  initTheme();
  render(
    <ThemeProvider>
      <ChoiceProbe />
    </ThemeProvider>,
  );
  expect(attributes()).toEqual({ theme: "ember", mode: "light", contrast: "high" });
  expect(document.documentElement.style.colorScheme).toBe("light");
  expect(screen.getByRole("status", { name: "choice" })).toHaveTextContent("ember light high");
});

test("mounting the provider again does not reset a choice made since (even when storage is blocked)", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("QuotaExceededError");
  });
  act(() => setThemeChoice({ theme: "nebula", mode: "light" }));
  const { unmount } = render(
    <ThemeProvider>
      <ChoiceProbe />
    </ThemeProvider>,
  );
  unmount();
  render(
    <ThemeProvider>
      <ChoiceProbe />
    </ThemeProvider>,
  );
  expect(screen.getByRole("status", { name: "choice" })).toHaveTextContent("nebula light normal");
  expect(attributes()).toMatchObject({ theme: "nebula", mode: "light" });
  vi.restoreAllMocks();
});

test("setChoice applies instantly, re-renders consumers and persists", async () => {
  const user = userEvent.setup();
  render(
    <ThemeProvider>
      <ChoiceProbe />
    </ThemeProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Nebula" }));
  await user.click(screen.getByRole("button", { name: "Light" }));
  await user.click(screen.getByRole("button", { name: "High contrast" }));
  expect(screen.getByRole("status", { name: "choice" })).toHaveTextContent("nebula light high");
  expect(attributes()).toEqual({ theme: "nebula", mode: "light", contrast: "high" });
  expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual({ theme: "nebula", mode: "light", contrast: true });
});

test("useThemePalette hands canvas and WebGL code the live palette after a switch", () => {
  render(
    <ThemeProvider>
      <PaletteProbe />
    </ThemeProvider>,
  );
  const output = screen.getByRole("status", { name: "primary" });
  expect(output).toHaveTextContent(resolvePalette({ theme: "orbital", mode: "dark", contrast: false }).primary);
  act(() => setThemeChoice({ theme: "ember", mode: "light" }));
  expect(output).toHaveTextContent(resolvePalette({ theme: "ember", mode: "light", contrast: false }).primary);
  act(() => setThemeChoice({ theme: "terminal" }));
  expect(output).toHaveTextContent("#FFD27A");
});

test("a change saved in another tab is picked up", () => {
  render(
    <ThemeProvider>
      <ChoiceProbe />
    </ThemeProvider>,
  );
  const value = JSON.stringify({ theme: "clearsky", mode: "dark", contrast: false });
  window.localStorage.setItem(STORAGE_KEY, value);
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY, newValue: value }));
  });
  expect(screen.getByRole("status", { name: "choice" })).toHaveTextContent("clearsky light normal");
  expect(attributes().theme).toBe("clearsky");
});

test("ThemeToggle flips between dark and light mode and updates its label", async () => {
  const user = userEvent.setup();
  render(<ThemeToggle />);
  await user.click(screen.getByRole("button", { name: "Switch to light mode" }));
  expect(attributes()).toMatchObject({ theme: "orbital", mode: "light" });
  expect(screen.getByRole("button", { name: "Switch to dark mode" })).toBeInTheDocument();
});

test("ThemeToggle is disabled for a fixed theme", () => {
  act(() => setThemeChoice({ theme: "terminal" }));
  render(<ThemeToggle />);
  const button = screen.getByRole("button", { name: /mode/i });
  expect(button).toBeDisabled();
  expect(button).toHaveAccessibleDescription("Terminal has a single look");
});
