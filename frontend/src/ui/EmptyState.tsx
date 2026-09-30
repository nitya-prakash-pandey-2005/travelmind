import { Link, type LinkProps } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { Button } from "./Button";
import { cn } from "./cn";

export type EmptyStateAction = { label: string } & ({ onClick: () => void; to?: never } | { to: LinkProps["to"]; onClick?: never });

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  /** One line explaining what fills this space. */
  description?: string;
  action?: EmptyStateAction;
  className?: string;
};

/** A designed empty state: what will appear here, why it is empty, and the one action that fills it. */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div role="status" className={cn("flex flex-col items-center gap-3 px-4 py-8 text-center", className)}>
      {Icon && (
        <span
          aria-hidden="true"
          className="tm-tint relative grid h-11 w-11 place-items-center rounded-md border text-primary"
        >
          <Icon size={20} strokeWidth={1.75} />
        </span>
      )}
      <div className="flex max-w-sm flex-col gap-1">
        <p className="font-display text-base tracking-wide text-ink">{title}</p>
        {description && <p className="text-sm text-dim">{description}</p>}
      </div>
      {action &&
        (action.to !== undefined ? (
          <Link
            to={action.to}
            className={cn(
              "inline-flex h-8 items-center justify-center rounded-sm border border-primary/50 px-3",
              "font-display text-xs uppercase tracking-[0.14em] text-primary transition duration-200 ease-tm",
              "hover:border-primary hover:bg-hover",
            )}
          >
            {action.label}
          </Link>
        ) : (
          <Button variant="ghost" size="sm" onClick={action.onClick}>
            {action.label}
          </Button>
        ))}
    </div>
  );
}
