import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { buttonClasses } from "../../ui/Button";
import { cn } from "../../ui/cn";

type CtaVariant = "primary" | "secondary" | "text";

/** The marketing page's larger size sits above the app's 32/36 px buttons. */
const SIZES = {
  sm: { size: "sm", className: "" },
  md: { size: "md", className: "" },
  lg: { size: "md", className: "h-10 px-4" },
} as const;

type CtaLinkProps = {
  to: "/demo" | "/signup" | "/login";
  variant?: CtaVariant;
  size?: keyof typeof SIZES;
  /**
   * Heard after the visible label by screen readers, for a repeated call to action (nav, footer,
   * closing band): "Create workspace for your agency" is distinct from the hero's "Create workspace".
   */
  context?: string;
  className?: string;
  children: ReactNode;
};

/** A call to action that navigates (a link styled as a button, or as plain text in the footer). */
export function CtaLink({ to, variant = "primary", size = "md", context, className, children }: CtaLinkProps) {
  const classes =
    variant === "text"
      ? "inline-flex items-center rounded-sm text-[13px] text-dim transition-colors duration-150 ease-tm hover:text-ink"
      : buttonClasses({ variant, size: SIZES[size].size, className: SIZES[size].className });
  return (
    <Link to={to} className={cn(classes, className)}>
      {children}
      {context && <span className="sr-only">{context}</span>}
    </Link>
  );
}
