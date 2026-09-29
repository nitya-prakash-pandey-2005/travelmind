import { Moon, Sun } from "lucide-react";
import { useTheme } from "./theme";

export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const next = theme === "dark" ? "daylight" : "dark";
  const label = next === "daylight" ? "Switch to daylight theme" : "Switch to dark theme";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setTheme(next)}
      className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-line text-dim transition hover:border-primary/70 hover:text-primary"
    >
      {theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
    </button>
  );
}
