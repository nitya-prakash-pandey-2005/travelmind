import { Moon, Sun } from "lucide-react";
import { useModeToggle } from "../theme";

/** Dark/light flip for headers. Disabled (with the reason as its description) while a fixed theme is showing. */
export function ThemeToggle() {
  const { available, mode, label, unavailableReason, toggle } = useModeToggle();
  return (
    <button
      type="button"
      aria-label={label}
      title={available ? label : unavailableReason}
      disabled={!available}
      onClick={toggle}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-dim transition-colors duration-150 ease-tm hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-dim"
    >
      {mode === "dark" ? <Sun size={16} strokeWidth={1.75} aria-hidden="true" /> : <Moon size={16} strokeWidth={1.75} aria-hidden="true" />}
    </button>
  );
}
