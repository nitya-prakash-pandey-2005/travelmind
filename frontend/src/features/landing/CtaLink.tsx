import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "../../ui/cn";

type CtaVariant = "primary" | "ghost" | "text";

const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm font-display uppercase tracking-[0.14em] transition duration-200 ease-tm";

const VARIANTS: Record<CtaVariant, string> = {
  primary: "tm-glow bg-primary text-primary-ink hover:brightness-110",
  ghost: "border border-line bg-void/40 text-ink hover:border-primary/70 hover:text-primary",
  text: "text-dim hover:text-ink",
};

const SIZES = {
  sm: "h-9 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-sm",
} as const;

type CtaLinkProps = {
  to: "/demo" | "/signup" | "/login";
  variant?: CtaVariant;
  size?: keyof typeof SIZES;
  /**
   * Heard after the visible label by screen readers, for a repeated call to action (nav, footer,
   * closing band): "Start free: create an agency account" is distinct from the hero's "Start free".
   */
  context?: string;
  className?: string;
  children: ReactNode;
};

/** A call to action that navigates (a link styled as a button). */
export function CtaLink({ to, variant = "primary", size = "md", context, className, children }: CtaLinkProps) {
  return (
    <Link to={to} className={cn(BASE, SIZES[size], VARIANTS[variant], className)}>
      {children}
      {context && <span className="sr-only">{context}</span>}
    </Link>
  );
}
