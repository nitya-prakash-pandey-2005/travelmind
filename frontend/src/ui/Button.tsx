import { LoaderCircle } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "./cn";

/**
 * The kit's buttons. primary: the one main action, on the accent gradient with a soft glow · secondary: the kit
 * `.btn` (raised glass and a hairline) · ghost: text-only, for toolbars and low-emphasis actions · danger:
 * destructive actions, tinted in the alert tone.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  /** sm = 34px, md = 40px. */
  size?: ButtonSize;
  /** Square button holding only an icon; give it an aria-label. */
  iconOnly?: boolean;
  loading?: boolean;
};

const VARIANTS: Record<ButtonVariant, string> = {
  // The solid primary under the gradient keeps the label readable if the gradient is ever dropped.
  primary:
    "bg-primary bg-(image:--tm-grad) font-semibold text-primary-ink shadow-[0_8px_30px_-8px_var(--tm-glow)] hover:shadow-[0_10px_36px_-4px_var(--tm-glow)]",
  secondary: "border border-line-soft bg-card-2 text-ink hover:border-line-strong hover:bg-hover",
  ghost: "text-dim hover:bg-card-2 hover:text-ink",
  danger: "tone-fill border text-danger hover:border-danger",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-[34px] rounded-[10px] px-3 text-[13px]",
  md: "h-10 rounded-md px-4 text-sm",
};

const ICON_SIZES: Record<ButtonSize, string> = {
  sm: "h-[34px] w-[34px] rounded-[10px]",
  md: "h-10 w-10 rounded-md",
};

/** Shared by Button and link-styled buttons so both read the same. */
export function buttonClasses({
  variant = "primary",
  size = "md",
  iconOnly = false,
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; iconOnly?: boolean; className?: string } = {}): string {
  return cn(
    "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap font-medium",
    "transition-[color,background-color,border-color,box-shadow,scale] duration-150 ease-tm active:scale-[0.98]",
    "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
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
