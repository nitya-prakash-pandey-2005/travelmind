import { Link, type LinkProps } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

export type Crumb = { label: string; to?: LinkProps["to"] };

type PageHeaderProps = {
  title: string;
  /** One line under the title (14px, secondary text). */
  description?: ReactNode;
  /** Trail above the title (the kit's HUD kicker); the last crumb is the current page and is not a link. */
  breadcrumb?: Crumb[];
  /** Right-aligned: secondary buttons first, then at most one primary. */
  actions?: ReactNode;
  /** Inline next to the title: a status pill, a count, a live indicator. */
  meta?: ReactNode;
  /** A tab row under the header (e.g. <Tabs />); the header then ends on the tabs' bottom border. */
  tabs?: ReactNode;
  /** Kept for callers: the kit's HUD grid now runs behind every page (the shell's ambient background). */
  dotGrid?: boolean;
  className?: string;
};

/**
 * The top of every app page, as the kit's page head: the breadcrumb as a HUD kicker, the title (the page's h1) in
 * Space Grotesk, the description and the actions on the right, with an optional tab row beneath. Sits directly
 * inside the shell's content column.
 */
export function PageHeader({ title, description, breadcrumb, actions, meta, tabs, dotGrid = false, className }: PageHeaderProps) {
  return (
    <div data-page-header="" data-dot-grid={dotGrid || undefined} className={cn("relative flex flex-col gap-4", tabs ? "mb-5" : "mb-6", className)}>
      <div className="page-head mb-0 justify-between gap-x-6 gap-y-3">
        <div className="grow max-w-3xl">
          {breadcrumb && breadcrumb.length > 0 && (
            <nav aria-label="Breadcrumb" className="mb-2">
              <ol className="hud flex flex-wrap items-center gap-1.5">
                {breadcrumb.map((crumb, index) => {
                  const last = index === breadcrumb.length - 1;
                  return (
                    <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
                      {index > 0 && <ChevronRight size={11} aria-hidden="true" className="shrink-0" />}
                      {crumb.to && !last ? (
                        <Link to={crumb.to} className="truncate rounded-[4px] transition-colors duration-150 hover:text-ink">
                          {crumb.label}
                        </Link>
                      ) : (
                        <span aria-current={last ? "page" : undefined} className={cn("truncate", last && "text-primary")}>
                          {crumb.label}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </nav>
          )}
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="tm-page-title min-w-0 text-ink">{title}</h1>
            {meta && <div className="flex items-center gap-2">{meta}</div>}
          </div>
          {description && <p className="mt-1.5 text-sm leading-5 text-dim">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {tabs && <div className="-mb-px">{tabs}</div>}
    </div>
  );
}
