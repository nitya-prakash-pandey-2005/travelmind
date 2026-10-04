import { themeMeta } from "./palettes";
import { useThemeChoice } from "./store";

/** A one-click dark/light flip for menus and headers. `available` is false while a fixed theme is showing. */
export function useModeToggle() {
  const [choice, setChoice] = useThemeChoice();
  const meta = themeMeta(choice.theme);
  const next = choice.mode === "dark" ? "light" : "dark";
  return {
    available: meta.modes === "toggle",
    mode: choice.mode,
    label: next === "light" ? "Switch to light mode" : "Switch to dark mode",
    unavailableReason: `${meta.name} has a single look`,
    toggle: () => setChoice({ mode: next }),
  };
}
