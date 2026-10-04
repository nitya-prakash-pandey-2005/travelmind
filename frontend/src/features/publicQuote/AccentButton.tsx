import { LoaderCircle } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../../ui/cn";

/**
 * The page's main action: the kit's gradient primary, in the agency's accent when it passes the contrast checks in
 * brandAccent (`--pq-accent-fill`), else the theme gradient. Hover settles on the solid hover step; hidden on paper.
 */
export function AccentButton({
  loading = false,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ComponentProps<"button"> & { loading?: boolean }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex h-11 shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md px-4",
        "text-sm font-semibold transition-[background-color,box-shadow,scale] duration-150 ease-tm active:scale-[0.98]",
        "bg-(--pq-accent) bg-(image:--pq-accent-fill) text-(color:--pq-accent-ink) shadow-[0_8px_26px_-10px_var(--pq-accent)]",
        "hover:bg-(--pq-accent-hover) hover:bg-none active:bg-(--pq-accent-hover) active:bg-none",
        "disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 print:hidden [&_svg]:shrink-0",
        className,
      )}
      {...rest}
    >
      {loading && <LoaderCircle size={15} aria-hidden="true" className="tm-spin" />}
      {children}
    </button>
  );
}
