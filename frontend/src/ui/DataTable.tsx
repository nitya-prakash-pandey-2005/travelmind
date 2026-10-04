import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Skeleton } from "./Skeleton";
import { cn } from "./cn";

export type SortDirection = "asc" | "desc";
export type SortState = { key: string; direction: SortDirection };

export type DataTableColumn<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Makes the column sortable. Strings sort naturally ("E-2" before "E-10"), numbers numerically. */
  sortValue?: (row: T) => string | number;
  align?: "left" | "right" | "center";
  /** Extra classes for this column's cells (e.g. a width). */
  className?: string;
};

type DataTableProps<T> = {
  columns: ReadonlyArray<DataTableColumn<T>>;
  rows: ReadonlyArray<T>;
  getRowId: (row: T) => string;
  /** Accessible name of the table (visually hidden caption). */
  caption: string;
  /** Shown in place of the body when there are no rows. */
  emptyState: ReactNode;
  loading?: boolean;
  onRowClick?: (row: T) => void;
  initialSort?: SortState;
  /**
   * Per-row actions (icon buttons, a Menu) in a trailing column. They show on row hover and whenever focus is
   * inside the row, so they stay reachable by keyboard; clicks on them don't trigger onRowClick.
   */
  rowActions?: (row: T) => ReactNode;
  /**
   * Classes for the scroll box around the table. The header is sticky only within this box, so give it a
   * height limit (e.g. "max-h-96") when the header should stay visible while rows scroll.
   */
  className?: string;
};

const SKELETON_ROWS = 5;
const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;
const JUSTIFY = { left: "justify-start", right: "justify-end", center: "justify-center" } as const;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compare(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}

/**
 * Data table: sticky header, sortable columns (header buttons with aria-sort), skeleton rows while loading,
 * an empty state, and optional row activation by click or Enter. Scrolls horizontally inside its own box.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  caption,
  emptyState,
  loading = false,
  onRowClick,
  initialSort,
  rowActions,
  className,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState | null>(initialSort ?? null);

  const sorted = useMemo(() => {
    const column = sort && columns.find((c) => c.key === sort.key);
    if (!sort || !column?.sortValue) return rows;
    const value = column.sortValue;
    const factor = sort.direction === "asc" ? 1 : -1;
    // Array.prototype.sort is stable, so ties keep their incoming order.
    return [...rows].sort((a, b) => factor * compare(value(a), value(b)));
  }, [rows, columns, sort]);

  function toggle(key: string) {
    setSort((current) =>
      current?.key === key && current.direction === "asc" ? { key, direction: "desc" } : { key, direction: "asc" },
    );
  }

  function onRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, row: T) {
    if (event.key === "Enter" && event.target === event.currentTarget) {
      event.preventDefault();
      onRowClick?.(row);
    }
  }

  const empty = !loading && rows.length === 0;
  const columnCount = columns.length + (rowActions ? 1 : 0);

  return (
    <div className={cn("relative max-w-full overflow-x-auto", className)}>
      <table aria-busy={loading || undefined} className="w-full border-separate border-spacing-0 text-[13px] leading-5 [&>tbody>tr:last-child>td]:border-b-0">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => {
              const align = column.align ?? "left";
              const active = sort?.key === column.key;
              const ariaSort = column.sortValue ? (active ? (sort.direction === "asc" ? "ascending" : "descending") : "none") : undefined;
              const SortIcon = active ? (sort.direction === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className={cn(
                    "sticky top-0 z-10 h-10 whitespace-nowrap border-b border-line bg-surface px-3 align-middle",
                    "tm-micro",
                    ALIGN[align],
                    column.className,
                  )}
                >
                  {column.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggle(column.key)}
                      className={cn(
                        "group -mx-1 inline-flex items-center gap-1 rounded-[4px] px-1 uppercase tracking-[0.14em]",
                        "transition-colors duration-150 ease-tm hover:text-ink",
                        align === "right" && "flex-row-reverse",
                        active && "text-ink",
                      )}
                    >
                      {column.header}
                      <SortIcon
                        size={12}
                        aria-hidden="true"
                        className={cn(active ? "text-primary" : "opacity-40 group-hover:opacity-80")}
                      />
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
            {rowActions && (
              <th scope="col" className="sticky top-0 z-10 h-10 w-px border-b border-line bg-surface px-3">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: SKELETON_ROWS }, (_, index) => (
              <tr key={`skeleton-${index}`}>
                {columns.map((column) => (
                  <td key={column.key} className="h-11 border-b border-line px-3">
                    <div className={cn("flex", JUSTIFY[column.align ?? "left"])}>
                      <Skeleton className={cn("h-3.5", index % 2 === 0 ? "w-3/4" : "w-1/2")} />
                    </div>
                  </td>
                ))}
                {rowActions && <td className="h-11 border-b border-line px-3" />}
              </tr>
            ))}
          {empty && (
            <tr>
              <td colSpan={columnCount} className="px-3 py-2">
                {emptyState}
              </td>
            </tr>
          )}
          {!loading &&
            sorted.map((row) => (
              <tr
                key={getRowId(row)}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? (event) => onRowKeyDown(event, row) : undefined}
                className={cn(
                  "group/row transition-colors duration-100 ease-tm hover:bg-card-2",
                  onRowClick && "cursor-pointer focus-visible:bg-card-2 focus-visible:-outline-offset-2",
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      "h-11 border-b border-line px-3 py-2 text-ink",
                      ALIGN[column.align ?? "left"],
                      column.align === "right" && "font-mono tabular-nums",
                      column.className,
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
                {rowActions && (
                  <td
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                    className="h-11 whitespace-nowrap border-b border-line px-2 text-right"
                  >
                    <div className="inline-flex items-center gap-1 opacity-0 transition-opacity duration-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 max-lg:opacity-100">
                      {rowActions(row)}
                    </div>
                  </td>
                )}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
