import type { ReactNode } from "react";
import { cn } from "../../ui/cn";

/** The kit's HUD kicker above a section title: mono, uppercase, in the accent, led by a short gradient rule. */
export function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("hud c-pink mb-3 flex items-center gap-2.5", className)}>
      <span aria-hidden="true" className="h-px w-6 shrink-0 bg-primary bg-(image:--tm-grad)" />
      {children}
    </p>
  );
}
