import { useRef, type KeyboardEvent } from "react";
import { cn } from "../../ui/cn";

export type ChipTab = { id: string; label: string; count?: number | string };

/**
 * A tab list drawn as the kit's chips (a filter row): the selected chip takes the soft accent gradient. Keyboard as
 * a tab list: Left/Right move and select, Home/End jump, only the selected chip is in the Tab order. Chips wrap on
 * narrow screens, so none is ever hidden. A chip's name is its label and count ("Sent 8").
 */
export function ChipTabs({
  tabs,
  value,
  onChange,
  label,
  className,
}: {
  tabs: readonly ChipTab[];
  value: string;
  onChange: (id: string) => void;
  /** Accessible name of the tab list. */
  label: string;
  className?: string;
}) {
  const refs = useRef(new Map<string, HTMLButtonElement>());

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = tabs.findIndex((tab) => tab.id === value);
    const moves: Record<string, number> = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: tabs.length - 1 };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const tab = tabs[(target + tabs.length) % tabs.length];
    if (!tab) return;
    onChange(tab.id);
    refs.current.get(tab.id)?.focus();
  }

  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cn("flex min-w-0 flex-wrap gap-1.5", className)}>
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              if (node) refs.current.set(tab.id, node);
              else refs.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn("chip min-h-8", selected && "on")}
          >
            {tab.label}
            {tab.count !== undefined && (
              <>
                {" "}
                <span className={cn("font-mono text-[11px] tabular-nums", selected ? "text-ink" : "text-faint")}>{tab.count}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
