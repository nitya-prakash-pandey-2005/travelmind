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
      className={cn("flex max-w-full gap-3 overflow-x-auto overflow-y-hidden border-b border-line", className)}
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
              "relative inline-flex h-10 shrink-0 items-center px-1 text-[13px] font-medium",
              "transition-colors duration-150 ease-tm focus-visible:outline-offset-[-2px]",
              // The selected underline is painted inside the tab (not over the list's border) so the
              // horizontally scrolling list never overflows vertically.
              "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors",
              selected ? "text-ink after:bg-primary" : "text-dim after:bg-transparent hover:text-ink",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
