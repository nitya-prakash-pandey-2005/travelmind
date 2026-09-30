import type { LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn";

export type MenuItem = {
  label: string;
  onSelect: () => void;
  icon?: LucideIcon;
  danger?: boolean;
};

type MenuProps = {
  /** Content of the trigger button (text and/or icon). */
  trigger: ReactNode;
  items: MenuItem[];
  /** Accessible name for the trigger; required when `trigger` is only an icon. */
  label?: string;
  /** Which trigger edge the menu lines up with. */
  align?: "start" | "end";
  className?: string;
  triggerClassName?: string;
};

/**
 * Action menu (menu button pattern): Enter/Space/ArrowDown open on the first item, ArrowUp on the last;
 * arrows wrap, Home/End jump, Escape closes back to the trigger, Tab or an outside click dismisses.
 */
export function Menu({ trigger, items, label, align = "end", className, triggerClassName }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [initialIndex, setInitialIndex] = useState(0);
  const menuId = useId();
  const triggerId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function openAt(index: number) {
    setInitialIndex(index);
    setOpen(true);
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    itemRefs.current[initialIndex]?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, initialIndex]);

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openAt(0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openAt(items.length - 1);
    }
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = itemRefs.current.findIndex((node) => node === document.activeElement);
    const last = items.length - 1;
    const targets: Record<string, number> = {
      ArrowDown: current >= last ? 0 : current + 1,
      ArrowUp: current <= 0 ? last : current - 1,
      Home: 0,
      End: last,
    };
    const target = targets[event.key];
    if (target !== undefined) {
      event.preventDefault();
      itemRefs.current[target]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation(); // don't also close an enclosing dialog
      close(true);
    } else if (event.key === "Tab") {
      close(false);
    }
  }

  function select(item: MenuItem) {
    // Close and restore focus first, so anything the action opens (a dialog) returns focus to the trigger.
    close(true);
    item.onSelect();
  }

  return (
    <div ref={rootRef} className={cn("relative inline-flex", className)}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openAt(0))}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-sm border border-line px-2.5 text-sm text-dim",
          "transition-colors duration-200 ease-tm hover:border-primary/60 hover:text-ink",
          open && "border-primary/60 text-ink",
          triggerClassName,
        )}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          onKeyDown={onMenuKeyDown}
          className={cn(
            "tm-enter tm-edge absolute top-full z-40 mt-1.5 flex min-w-44 max-w-[calc(100vw-2rem)] flex-col rounded-md p-1",
            "bg-glass-strong shadow-(--tm-shadow-pop) backdrop-blur-xl",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {items.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => select(item)}
                className={cn(
                  "flex h-8 w-full items-center gap-2.5 rounded-sm px-2.5 text-left text-sm",
                  "transition-colors duration-150 ease-tm hover:bg-hover focus:bg-hover focus-visible:-outline-offset-2",
                  item.danger ? "text-danger" : "text-ink",
                )}
              >
                {Icon && <Icon size={15} aria-hidden="true" className={item.danger ? undefined : "text-dim"} />}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
