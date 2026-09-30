import { useRef, type KeyboardEvent } from "react";
import { cn } from "./cn";

export type TabItem = {
  id: string;
  label: string;
  /** id of the tabpanel this tab controls, when the caller renders one. */
  panelId?: string;
};

type TabsProps = {
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Accessible name of the tab list. */
  label: string;
  className?: string;
};

/**
 * Controlled tab list (automatic activation): Left/Right move and select, Home/End jump, focus follows.
 * Only the selected tab is in the Tab order.
 */
export function Tabs({ tabs, value, onChange, label, className }: TabsProps) {
  const refs = useRef(new Map<string, HTMLButtonElement>());

  function select(index: number) {
    const tab = tabs[(index + tabs.length) % tabs.length];
    if (!tab) return;
    onChange(tab.id);
    refs.current.get(tab.id)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = tabs.findIndex((tab) => tab.id === value);
    const moves: Record<string, number> = {
      ArrowRight: current + 1,
      ArrowLeft: current - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    select(target);
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn("flex max-w-full gap-1 overflow-x-auto border-b border-line", className)}
    >
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
            id={tab.panelId ? `${tab.panelId}-tab` : undefined}
            aria-selected={selected}
            aria-controls={tab.panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative -mb-px shrink-0 border-b-2 px-3 pb-2.5 pt-2 font-display text-xs uppercase tracking-[0.16em]",
              "transition-colors duration-200 ease-tm focus-visible:outline-offset-[-2px]",
              selected ? "border-primary text-ink" : "border-transparent text-dim hover:text-ink",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
