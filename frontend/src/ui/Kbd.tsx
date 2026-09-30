import type { ReactNode } from "react";
import { cn } from "./cn";

/** A keyboard key or shortcut, e.g. <Kbd>Ctrl K</Kbd>. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-line bg-surface-2 px-1.5",
        "font-mono text-[10px] font-medium leading-none text-dim",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
