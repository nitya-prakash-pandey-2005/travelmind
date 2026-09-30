import { Link, type LinkProps } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

export type Crumb = { label: string; to?: LinkProps["to"] };

type PageHeaderProps = {
  title: string;
  /** One line under the title (13px, secondary text). */
  description?: ReactNode;
  /** Trail above the title; the last crumb is the current page and is not a link. */
  breadcrumb?: Crumb[];
  /** Right-aligned: secondary buttons first, then at most one primary. */
  actions?: ReactNode;
  /** Inline next to the title: a status pill, a count, a live indicator. */
  meta?: ReactNode;
  /** A tab row under the header (e.g. <Tabs />); the header then ends on the tabs' bottom border. */
  tabs?: ReactNode;
  /** The faint dot-grid backdrop. Reserved for the Command Center header. */
  dotGrid?: boolean;
  className?: string;
};

/**
 * The top of every app page: breadcrumb, title (the page's h1), description and actions, with an optional
 * tab row beneath. Sits directly inside the shell's padded <main>.
 */
export function PageHeader({ title, description, breadcrumb, actions, meta, tabs, dotGrid = false, className }: PageHeaderProps) {
  return (
    <div
      data-page-header=""
      className={cn(
        "relative flex flex-col gap-4",
        tabs ? "mb-5" : "mb-6",
        dotGrid && "tm-dot-grid -mx-4 -mt-4 px-4 pt-4 lg:-mx-6 lg:-mt-6 lg:px-6 lg:pt-6",
        dotGrid && !tabs && "pb-5",
        className,
      )}
    >
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-3xl">
          {breadcrumb && breadcrumb.length > 0 && (
            <nav aria-label="Breadcrumb" className="mb-1.5">
              <ol className="flex flex-wrap items-center gap-1 text-xs leading-4 text-faint">
                {breadcrumb.map((crumb, index) => {
                  const last = index === breadcrumb.length - 1;
                  return (
                    <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1">
                      {index > 0 && <ChevronRight size={12} aria-hidden="true" className="shrink-0" />}
                      {crumb.to && !last ? (
                        <Link to={crumb.to} className="truncate rounded-[4px] transition-colors duration-150 hover:text-ink">
                          {crumb.label}
                        </Link>
                      ) : (
                        <span aria-current={last ? "page" : undefined} className={cn("truncate", last && "text-dim")}>
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
          {description && <p className="mt-1 text-[13px] leading-5 text-dim">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {tabs && <div className="-mb-px">{tabs}</div>}
    </div>
  );
}
