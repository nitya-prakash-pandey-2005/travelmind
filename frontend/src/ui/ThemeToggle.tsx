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
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-transparent text-dim transition-colors duration-200 ease-tm hover:border-line hover:bg-hover hover:text-ink"
    >
      {theme === "dark" ? <Sun size={17} strokeWidth={1.75} aria-hidden="true" /> : <Moon size={17} strokeWidth={1.75} aria-hidden="true" />}
    </button>
  );
}
