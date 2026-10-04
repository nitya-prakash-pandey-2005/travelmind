import { act, render, screen, within } from "@testing-library/react";
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

test("Space picks the active theme, like Enter", async () => {
  const user = userEvent.setup();
  render(<ThemeSwitcher />);
  screen.getByRole("button", { name: "Theme: Orbital" }).focus();
  await user.keyboard(" ");
  expect(screen.getByRole("listbox", { name: "Theme" })).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  await user.keyboard(" ");
  expect(html.dataset.theme).toBe("nebula");
  expect(screen.getByRole("option", { name: /Nebula/ })).toHaveAttribute("aria-selected", "true");
});

test("Escape on the trigger closes an open panel and keeps focus there", async () => {
  const user = userEvent.setup();
  render(<ThemeSwitcher />);
  const trigger = screen.getByRole("button", { name: "Theme: Orbital" });
  trigger.focus();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("listbox", { name: "Theme" })).toHaveFocus();
  await user.keyboard("{Shift>}{Tab}{/Shift}");
  expect(trigger).toHaveFocus();
  expect(screen.getByRole("listbox", { name: "Theme" })).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("the active option follows a theme changed elsewhere while the panel is open", async () => {
  const user = userEvent.setup();
  render(<ThemeSwitcher />);
  await user.click(screen.getByRole("button", { name: "Theme: Orbital" }));
  expect(activeOption()).toHaveTextContent("Orbital");
  act(() => setThemeChoice({ theme: "terminal" }));
  expect(screen.getByRole("option", { name: /Terminal/ })).toHaveAttribute("aria-selected", "true");
  expect(activeOption()).toHaveTextContent("Terminal");
  await user.keyboard("{ArrowDown}");
  expect(activeOption()).toHaveTextContent("Contrast");
});

test("an option shows either the hover fill or the selected fill, never both", async () => {
  const user = userEvent.setup();
  render(<ThemeSwitcher />);
  await user.click(screen.getByRole("button", { name: "Theme: Orbital" }));
  const list = screen.getByRole("listbox", { name: "Theme" });
  const orbital = within(list).getByRole("option", { name: /Orbital/ });
  // Orbital is both selected and active.
  expect(activeOption()).toBe(orbital);
  expect(orbital).toHaveClass("bg-selected");
  expect(orbital).not.toHaveClass("bg-hover");
  await user.keyboard("{ArrowDown}");
  const nebula = within(list).getByRole("option", { name: /Nebula/ });
  expect(nebula).toHaveClass("bg-hover");
  expect(nebula).not.toHaveClass("bg-selected");
  expect(orbital).toHaveClass("bg-selected");
});

test("on a narrow screen the panel is moved back inside the viewport", async () => {
  const user = userEvent.setup();
  const width = vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(360);
  const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    // The right-aligned panel as Chrome lays it out under a trigger at 272–334 px: 344 px wide, 10 px off the left edge.
    const shift = Number.parseFloat(this.style.translate || "0");
    const left = this.getAttribute("role") === "dialog" ? -10 + shift : 0;
    const right = this.getAttribute("role") === "dialog" ? 334 + shift : 0;
    return { left, right, x: left, y: 0, top: 0, bottom: 0, width: right - left, height: 0, toJSON: () => ({}) } as DOMRect;
  });
  try {
    render(<ThemeSwitcher />);
    await user.click(screen.getByRole("button", { name: "Theme: Orbital" }));
    const panel = screen.getByRole("dialog", { name: "Theme" });
    const box = panel.getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(8);
    expect(box.right).toBeLessThanOrEqual(352);
  } finally {
    rect.mockRestore();
    width.mockRestore();
  }
});
