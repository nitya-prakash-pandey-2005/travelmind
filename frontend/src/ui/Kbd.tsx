import type { ReactNode } from "react";
import { cn } from "./cn";

/** A keyboard key or shortcut, e.g. <Kbd>Ctrl K</Kbd>. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "kbd inline-flex h-5 min-w-5 items-center justify-center bg-card-2 px-1.5",
        "text-[10.5px] font-medium leading-none text-dim",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
