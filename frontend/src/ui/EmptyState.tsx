import { Link, type LinkProps } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { Button, buttonClasses } from "./Button";
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

/** Empty state: what will appear here, why it is empty, and the one action that fills it. */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div role="status" className={cn("flex flex-col items-center gap-3 px-4 py-8 text-center", className)}>
      {Icon && (
        <span
          aria-hidden="true"
          className="grid h-10 w-10 place-items-center rounded-lg border border-line bg-surface-2 text-dim"
        >
          <Icon size={18} strokeWidth={1.75} />
        </span>
      )}
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-sm font-semibold text-ink">{title}</p>
        {description && <p className="text-[13px] leading-5 text-dim">{description}</p>}
      </div>
      {action &&
        (action.to !== undefined ? (
          <Link to={action.to} className={buttonClasses({ variant: "primary", size: "sm", className: "mt-1" })}>
            {action.label}
          </Link>
        ) : (
          <Button size="sm" onClick={action.onClick} className="mt-1">
            {action.label}
          </Button>
        ))}
    </div>
  );
}
