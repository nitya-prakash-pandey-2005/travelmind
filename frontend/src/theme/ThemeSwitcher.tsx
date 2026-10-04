import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { cn } from "../ui/cn";
import { SegmentedControl } from "../ui/SegmentedControl";
import { themeMeta, THEMES } from "./palettes";
import { useThemeChoice } from "./store";
import type { ThemeMeta, ThemeMode } from "./types";

const MODE_OPTIONS = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
] as const;

/** A theme's four colours (bg, surface, primary, accent-2) as a small chip. */
export function ThemeSwatch({ theme, className }: { theme: ThemeMeta; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-grid h-5 w-7 shrink-0 grid-cols-4 overflow-hidden rounded-[4px] border border-line-strong", className)}
    >
      {theme.swatch.map((colour, index) => (
        <span key={index} style={{ backgroundColor: colour }} />
      ))}
    </span>
  );
}

type ThemePanelProps = {
  /** Escape inside the panel (a popover closes and hands focus back to its trigger). */
  onEscape?: () => void;
  /** Mark the list for the dialog's initial focus. */
  autoFocusList?: boolean;
  className?: string;
};

/**
 * The theme list (a listbox: Arrow keys, Home and End move, Enter or Space picks) with the mode and high-contrast
 * controls under it. Picking applies at once and is saved. Fixed themes (Clearsky, Terminal, Contrast) disable
 * the two controls and say why.
 */
export function ThemePanel({ onEscape, autoFocusList = false, className }: ThemePanelProps) {
  const [choice, setChoice] = useThemeChoice();
  const selectedIndex = Math.max(
    0,
    THEMES.findIndex((theme) => theme.id === choice.theme),
  );
  const [active, setActive] = useState(selectedIndex);
  // A theme picked elsewhere (another control, another tab) while the list is open moves the active option to it.
  const [shownIndex, setShownIndex] = useState(selectedIndex);
  if (shownIndex !== selectedIndex) {
    setShownIndex(selectedIndex);
    setActive(selectedIndex);
  }
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const noteId = `${baseId}-note`;
  const optionId = (index: number) => `${baseId}-option-${index}`;
  const meta = themeMeta(choice.theme);
  const fixed = meta.modes !== "toggle";

  function pick(index: number) {
    const theme = THEMES[index];
    if (!theme) return;
    setActive(index);
    setChoice({ theme: theme.id });
  }

  function moveTo(index: number) {
    const next = Math.min(THEMES.length - 1, Math.max(0, index));
    setActive(next);
    listRef.current?.querySelector(`#${CSS.escape(optionId(next))}`)?.scrollIntoView({ block: "nearest" });
  }

  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const targets: Record<string, number> = {
      ArrowDown: active + 1,
      ArrowUp: active - 1,
      Home: 0,
      End: THEMES.length - 1,
    };
    const target = targets[event.key];
    if (target !== undefined) {
      event.preventDefault();
      moveTo(target);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick(active);
    }
  }

  function onPanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && onEscape) {
      event.preventDefault();
      event.stopPropagation();
      onEscape();
    }
  }

  return (
    <div onKeyDown={onPanelKeyDown} className={cn("flex flex-col", className)}>
      <span id={labelId} className="tm-micro px-3 pb-1.5 pt-3">
        Theme
      </span>
      <div
        ref={listRef}
        role="listbox"
        tabIndex={0}
        aria-labelledby={labelId}
        aria-activedescendant={optionId(active)}
        data-autofocus={autoFocusList ? "" : undefined}
        data-theme-list=""
        onKeyDown={onListKeyDown}
        className="flex flex-col gap-0.5 px-1 pb-1 focus-visible:-outline-offset-2"
      >
        {THEMES.map((theme, index) => {
          const selected = theme.id === choice.theme;
          return (
            <div
              key={theme.id}
              id={optionId(index)}
              role="option"
              aria-selected={selected}
              onClick={() => pick(index)}
              onPointerMove={() => setActive(index)}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-md px-2 py-2",
                // One fill at a time: the selected fill wins over the active (hover) one, so text is only ever on one.
                selected ? "bg-selected" : index === active && "bg-hover",
              )}
            >
              <ThemeSwatch theme={theme} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn("text-[13px] font-medium leading-5", selected ? "text-primary" : "text-ink")}>{theme.name}</span>
                <span className="text-xs leading-4 text-dim">{theme.tagline}</span>
              </span>
              <Check
                size={15}
                strokeWidth={2}
                aria-hidden="true"
                className={cn("shrink-0 text-primary", selected ? "opacity-100" : "opacity-0")}
              />
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-3 border-t border-line px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-ink">Mode</span>
          <SegmentedControl
            label="Mode"
            options={MODE_OPTIONS}
            value={choice.mode}
            onChange={(mode: ThemeMode) => setChoice({ mode })}
            disabled={fixed}
            describedBy={fixed ? noteId : undefined}
          />
        </div>
        <ContrastSwitch checked={choice.contrast} disabled={fixed} describedBy={fixed ? noteId : undefined} onChange={(contrast) => setChoice({ contrast })} />
        {fixed && (
          <p id={noteId} className="text-xs leading-4 text-dim">
            {meta.name} has a single look, so mode and contrast are set by the theme.
          </p>
        )}
      </div>
    </div>
  );
}

function ContrastSwitch({
  checked,
  disabled,
  describedBy,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  describedBy?: string;
  onChange: (checked: boolean) => void;
}) {
  const labelId = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <span id={labelId} className={cn("text-[13px]", disabled ? "text-dim" : "text-ink")}>
        High contrast
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 ease-tm",
          "disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "border-primary bg-primary" : "border-line-strong bg-surface-2",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "inline-block h-3.5 w-3.5 rounded-full transition-transform duration-150 ease-tm",
            checked ? "translate-x-[1.05rem] bg-primary-ink" : "translate-x-0.5 bg-dim",
          )}
        />
      </button>
    </div>
  );
}

/** The least room the panel keeps from the viewport's left and right edges, in px. */
const EDGE_GAP = 8;

type ThemeSwitcherProps = {
  /** Which trigger edge the panel lines up with. */
  align?: "start" | "end";
  /** Hide the theme name next to the swatch below this breakpoint (tight headers). */
  hideNameBelow?: "sm" | "lg";
  className?: string;
};

/**
 * Header control "Theme: <name>": opens the theme list with the mode and high-contrast controls. Escape (in the
 * panel or on the trigger) closes it with focus on the trigger; a click outside or tabbing away closes it too.
 * The panel stays inside the viewport on narrow screens.
 */
export function ThemeSwitcher({ align = "end", hideNameBelow, className }: ThemeSwitcherProps) {
  const [choice] = useThemeChoice();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const meta = themeMeta(choice.theme);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>("[data-theme-list]")?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Narrow headers: a panel aligned to the trigger can run off the screen edge, so nudge it back inside.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const fit = () => {
      panel.style.translate = "";
      const { left, right } = panel.getBoundingClientRect();
      const viewport = document.documentElement.clientWidth || window.innerWidth;
      const shift = left < EDGE_GAP ? EDGE_GAP - left : right > viewport - EDGE_GAP ? viewport - EDGE_GAP - right : 0;
      if (shift) panel.style.translate = `${Math.round(shift)}px 0`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    if (open && next instanceof Node && !rootRef.current?.contains(next)) setOpen(false);
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape" && open) {
      // Focus is back on the trigger (e.g. Shift+Tab out of the list) with the panel still open.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
    }
  }

  return (
    <div ref={rootRef} onBlur={onBlur} className={cn("relative inline-flex", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Theme: ${meta.name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-md px-1.5 text-[13px] font-medium text-dim transition-colors duration-150 ease-tm hover:bg-hover hover:text-ink",
          open && "bg-hover text-ink",
        )}
      >
        <ThemeSwatch theme={meta} className="h-4 w-6" />
        <span className={cn(hideNameBelow === "sm" && "max-sm:hidden", hideNameBelow === "lg" && "max-lg:hidden")}>{meta.name}</span>
        <ChevronDown size={14} aria-hidden="true" className="text-faint" />
      </button>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="Theme"
          className={cn(
            "tm-enter tm-popover absolute top-full z-50 mt-1 w-[22rem] max-w-[calc(100vw-1rem)] rounded-lg",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          <ThemePanel onEscape={close} />
        </div>
      )}
    </div>
  );
}
