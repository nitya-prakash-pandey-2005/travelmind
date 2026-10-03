import { LoaderCircle } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../../ui/cn";

/**
 * The page's main action in the agency's accent (`--pq-accent`, contrast-checked in brandAccent). Same shape as
 * the design system's primary button; hidden on paper.
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
        "inline-flex h-10 shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md px-4",
        "text-sm font-medium transition-colors duration-150 ease-tm",
        "bg-(--pq-accent) text-(color:--pq-accent-ink) hover:bg-(--pq-accent-hover) active:bg-(--pq-accent-hover)",
        "disabled:cursor-not-allowed disabled:opacity-60 print:hidden [&_svg]:shrink-0",
        className,
      )}
      {...rest}
    >
      {loading && <LoaderCircle size={15} aria-hidden="true" className="tm-spin" />}
      {children}
    </button>
  );
}
