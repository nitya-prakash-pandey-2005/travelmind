import { Link, type LinkProps } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { useId } from "react";
import { Button, buttonClasses } from "./Button";
import { cn } from "./cn";

export type EmptyStateAction = { label: string } & (
  | {
      onClick: () => void;
      to?: never;
      /** Shown under the button, which is then disabled and described by it. */
      disabledReason?: string | null;
    }
  | { to: LinkProps["to"]; onClick?: never; disabledReason?: never }
);

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
  const reasonId = useId();
  const reason = action?.disabledReason;
  return (
    <div role="status" className={cn("flex flex-col items-center gap-3 px-4 py-8 text-center", className)}>
      {Icon && (
        <span
          aria-hidden="true"
          className="grid h-11 w-11 place-items-center rounded-[14px] border border-line bg-card-2 text-dim shadow-[0_0_24px_var(--tm-glow)]"
        >
          <Icon size={19} strokeWidth={1.75} />
        </span>
      )}
      <div className="flex max-w-sm flex-col gap-1">
        <p className="font-display text-[15px] font-semibold text-ink">{title}</p>
        {description && <p className="text-[13px] leading-5 text-dim">{description}</p>}
      </div>
      {action &&
        (action.to !== undefined ? (
          <Link to={action.to} className={buttonClasses({ variant: "primary", size: "sm", className: "mt-1" })}>
            {action.label}
          </Link>
        ) : (
          <>
            <Button size="sm" onClick={action.onClick} className="mt-1" disabled={Boolean(reason)} aria-describedby={reason ? reasonId : undefined}>
              {action.label}
            </Button>
            {reason && (
              <p id={reasonId} className="text-xs leading-4 text-dim">
                {reason}
              </p>
            )}
          </>
        ))}
    </div>
  );
}
