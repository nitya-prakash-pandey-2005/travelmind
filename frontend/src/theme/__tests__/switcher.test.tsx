import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { STORAGE_KEY } from "../storage";
import { initTheme, setThemeChoice } from "../store";
import { ThemeSwitcher } from "../ThemeSwitcher";

const html = document.documentElement;
const activeOption = () => {
  const list = screen.getByRole("listbox", { name: "Theme" });
  return document.getElementById(list.getAttribute("aria-activedescendant") ?? "");
};
const saved = () => JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");

test("the trigger names the current theme and the list shows all six with name, tagline and swatch", async () => {
  const user = userEvent.setup();
  render(<ThemeSwitcher />);
  await user.click(screen.getByRole("button", { name: "Theme: Orbital" }));
  const options = screen.getAllByRole("option");
  expect(options.map((option) => option.textContent)).toEqual([
    "OrbitalGraphite console, cyan telemetry",
    "NebulaViolet night with teal and violet glow",
    "EmberDeep indigo with saffron and amber warmth",
    "ClearskyBright and clean, for projectors and daylight",
    "TerminalAmber monochrome console, all monospace",
    "ContrastBlack, white and yellow; maximum legibility",
  ]);
  expect(screen.getByRole("option", { name: /Orbital/ })).toHaveAttribute("aria-selected", "true");
  for (const option of options) expect(option.querySelectorAll("[aria-hidden] > span")).toHaveLength(4);
});

test("keyboard: open, move with arrows/Home/End, pick with Enter, close with Escape back to the trigger", async () => {
  const user = userEvent.setup();
  render(<ThemeSwitcher />);
  const trigger = screen.getByRole("button", { name: "Theme: Orbital" });
  trigger.focus();
  await user.keyboard("{Enter}");
  const list = screen.getByRole("listbox", { name: "Theme" });
  expect(list).toHaveFocus();
  expect(activeOption()).toHaveTextContent("Orbital");

  await user.keyboard("{ArrowDown}");
  expect(activeOption()).toHaveTextContent("Nebula");
  await user.keyboard("{End}");
  expect(activeOption()).toHaveTextContent("Contrast");
  await user.keyboard("{ArrowDown}");
  expect(activeOption()).toHaveTextContent("Contrast");
  await user.keyboard("{Home}");
  expect(activeOption()).toHaveTextContent("Orbital");
  await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

  // Applied at once and saved; the panel stays open for the mode and contrast controls.
  expect(html.dataset.theme).toBe("ember");
  expect(saved()).toMatchObject({ theme: "ember" });
  expect(screen.getByRole("option", { name: /Ember/ })).toHaveAttribute("aria-selected", "true");

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  const updated = screen.getByRole("button", { name: "Theme: Ember" });
  expect(updated).toHaveFocus();
  expect(updated).toHaveAttribute("aria-expanded", "false");
});

test("ArrowDown on the trigger opens the list; a click outside closes it", async () => {
  const user = userEvent.setup();
  render(
    <>
      <ThemeSwitcher />
      <button type="button">Elsewhere</button>
    </>,
  );
  screen.getByRole("button", { name: "Theme: Orbital" }).focus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("listbox", { name: "Theme" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Elsewhere" }));
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

test("mode and high contrast apply instantly for toggle themes", async () => {
  const user = userEvent.setup();
  render(<ThemeSwitcher />);
  await user.click(screen.getByRole("button", { name: "Theme: Orbital" }));
  await user.click(screen.getByRole("radio", { name: "Light" }));
  expect(html.dataset.mode).toBe("light");
  await user.click(screen.getByRole("switch", { name: "High contrast" }));
  expect(screen.getByRole("switch", { name: "High contrast" })).toBeChecked();
  expect(html.dataset.contrast).toBe("high");
  expect(saved()).toEqual({ theme: "orbital", mode: "light", contrast: true });
});

test("fixed themes disable the mode and contrast controls and say why", async () => {
  const user = userEvent.setup();
  render(<ThemeSwitcher />);
  await user.click(screen.getByRole("button", { name: "Theme: Orbital" }));
  expect(screen.getByRole("radio", { name: "Dark" })).toBeEnabled();
  expect(screen.getByRole("switch", { name: "High contrast" })).toBeEnabled();

  await user.click(screen.getByRole("option", { name: /Clearsky/ }));
  expect(screen.getByRole("radio", { name: "Light" })).toBeDisabled();
  expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
  const contrast = screen.getByRole("switch", { name: "High contrast" });
  expect(contrast).toBeDisabled();
  expect(contrast).toHaveAccessibleDescription("Clearsky has a single look, so mode and contrast are set by the theme.");

  await user.click(screen.getByRole("option", { name: /Terminal/ }));
  expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
  expect(screen.getByRole("switch", { name: "High contrast" })).toBeDisabled();
  expect(html.dataset.theme).toBe("terminal");

  await user.click(screen.getByRole("option", { name: /Nebula/ }));
  expect(screen.getByRole("switch", { name: "High contrast" })).toBeEnabled();
  expect(screen.queryByText(/has a single look/)).not.toBeInTheDocument();
});

test("the choice survives a reload (remount after initTheme)", async () => {
  const user = userEvent.setup();
  const first = render(<ThemeSwitcher />);
  await user.click(screen.getByRole("button", { name: "Theme: Orbital" }));
  await user.click(screen.getByRole("option", { name: /Nebula/ }));
  await user.click(screen.getByRole("radio", { name: "Light" }));
  first.unmount();

  expect(saved()).toEqual({ theme: "nebula", mode: "light", contrast: false });

  // A fresh page: the in-memory store is back on the default (without touching storage), then main.tsx
  // re-reads storage.
  const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
  act(() => setThemeChoice({ theme: "orbital", mode: "dark" }));
  setItem.mockRestore();
  expect(html.dataset.theme).toBe("orbital");
  act(() => {
    initTheme();
  });
  render(<ThemeSwitcher />);
  expect(screen.getByRole("button", { name: "Theme: Nebula" })).toBeInTheDocument();
  expect(html.dataset).toMatchObject({ theme: "nebula", mode: "light", contrast: "normal" });
});
