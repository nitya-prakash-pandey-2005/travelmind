import type { ComponentProps } from "react";
import { cn } from "./cn";

type Variant = "primary" | "ghost" | "danger";

type ButtonProps = ComponentProps<"button"> & {
  variant?: Variant;
  size?: "sm" | "md";
  loading?: boolean;
};

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-primary-ink tm-glow hover:brightness-110",
  ghost: "border border-line text-ink hover:border-primary/70 hover:text-primary",
  danger: "border border-danger/60 text-danger hover:bg-danger/10",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  type = "button",
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-sm font-display uppercase tracking-[0.14em] transition",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading && (
        <span aria-hidden="true" className="tm-blink font-mono">
          ▮▮
        </span>
      )}
      {children}
    </button>
  );
}
