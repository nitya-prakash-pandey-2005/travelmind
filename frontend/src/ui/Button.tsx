import { LoaderCircle } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "./cn";

/**
 * primary: the one main action (accent fill) · secondary: everything else (surface + border) ·
 * ghost: text-only, for toolbars and low-emphasis actions · danger: destructive actions.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  /** sm = 32px, md = 36px. */
  size?: ButtonSize;
  /** Square button holding only an icon; give it an aria-label. */
  iconOnly?: boolean;
  loading?: boolean;
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-ink hover:bg-primary-hover active:bg-primary-active",
  secondary: "border border-line-strong bg-surface-2 text-ink hover:border-faint hover:bg-hover",
  ghost: "text-dim hover:bg-hover hover:text-ink",
  danger: "border border-danger/40 bg-surface-2 text-danger hover:border-danger/70 hover:bg-danger/10",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-9 px-3.5 text-sm",
};

const ICON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 w-8",
  md: "h-9 w-9",
};

/** Shared by Button and link-styled buttons so both read the same. */
export function buttonClasses({
  variant = "primary",
  size = "md",
  iconOnly = false,
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; iconOnly?: boolean; className?: string } = {}): string {
  return cn(
    "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium",
    "transition-colors duration-150 ease-tm",
    "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
    "[&_svg]:shrink-0",
    iconOnly ? ICON_SIZES[size] : SIZES[size],
    VARIANTS[variant],
    className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  iconOnly = false,
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
      className={buttonClasses({ variant, size, iconOnly, className })}
      {...rest}
    >
      {loading && <LoaderCircle size={size === "sm" ? 14 : 15} aria-hidden="true" className="tm-spin" />}
      {!(loading && iconOnly) && children}
    </button>
  );
}
