import { createContext, useContext, type ReactNode } from "react";
import { cn } from "../cn";

const InStrip = createContext(false);

/** True inside a KpiStrip: tiles drop their own frame and share the strip's hairlines. */
export function useInKpiStrip(): boolean {
  return useContext(InStrip);
}

// Spelled out so the class scanner sees them: tiles per row from the `lg` breakpoint.
const WIDE: Record<2 | 3 | 4 | 5 | 6 | 7 | 8, string> = {
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-3 xl:grid-cols-5",
  6: "lg:grid-cols-3 xl:grid-cols-6",
  7: "lg:grid-cols-4 min-[1600px]:grid-cols-7",
  8: "lg:grid-cols-4 min-[1600px]:grid-cols-8",
};

/**
 * One bordered strip of KPI tiles separated by 1px dividers (not separate boxes). Put KpiTile children
 * inside; the grid is 2 columns on phones, 3 on tablets and `columns` on wide screens. Rows that don't
 * fill up leave plain surface, never a stray divider.
 */
export function KpiStrip({
  label,
  columns = 4,
  busy,
  className,
  children,
}: {
  /** Accessible name of the strip (a region), e.g. "Key figures". */
  label: string;
  columns?: 2 | 3 | 4 | 5 | 6 | 7 | 8;
  busy?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      aria-busy={busy || undefined}
      className={cn("overflow-hidden rounded-lg border border-line bg-surface", className)}
    >
      {/* Each tile draws its right and bottom hairline; the -1px margins tuck the outer ones under the frame. */}
      <div className={cn("-mb-px -mr-px grid grid-cols-2", columns > 2 && "sm:grid-cols-3", WIDE[columns])}>
        <InStrip value>{children}</InStrip>
      </div>
    </section>
  );
}
