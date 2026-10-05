import { createContext, useContext, type ReactNode } from "react";
import { cn } from "../cn";

const InStrip = createContext(false);

/** True inside a KpiStrip: tiles become the strip's compact glass cards. */
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
  7: "lg:max-[1599px]:grid-cols-4 min-[1600px]:grid-cols-7",
  8: "lg:max-[1599px]:grid-cols-4 min-[1600px]:grid-cols-8",
};

/**
 * The kit's KPI row: a grid of compact glass Stat cards. Put KpiTile children inside; the grid is 2 columns on
 * phones (an odd last tile spans the row), 3 on tablets and `columns` on wide screens.
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
      className={cn("min-w-0", className)}
    >
      {/* On the 2-column phone grid an odd last tile takes the whole row instead of leaving a hole beside it. */}
      <div
        className={cn(
          "grid grid-cols-2 gap-3 max-sm:[&>:last-child:nth-child(odd)]:col-span-2",
          columns > 2 && "sm:grid-cols-3",
          WIDE[columns],
        )}
      >
        <InStrip value>{children}</InStrip>
      </div>
    </section>
  );
}
