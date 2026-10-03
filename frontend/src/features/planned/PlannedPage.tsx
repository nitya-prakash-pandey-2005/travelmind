import { Link, type LinkProps } from "@tanstack/react-router";
import { ArrowRight, CircleDashed, type LucideIcon } from "lucide-react";
import { Badge } from "../../ui/Badge";
import { PageHeader, type Crumb } from "../../ui/PageHeader";
import { Panel } from "../../ui/Panel";

export type RelatedPage = { to: LinkProps["to"]; label: string; hint: string; icon: LucideIcon };

type PlannedPageProps = {
  title: string;
  description: string;
  breadcrumb?: Crumb[];
  /** What the finished page will hold, one line each. */
  coming: string[];
  /** Where to do the related work today. */
  related: RelatedPage[];
};

/**
 * A page of this release whose screen is still being finished: the real header, what it will hold,
 * and links to the pages that cover the same work today. Each one is replaced by its finished screen.
 */
export function PlannedPage({ title, description, breadcrumb, coming, related }: PlannedPageProps) {
  return (
    <>
      <PageHeader
        title={title}
        description={description}
        breadcrumb={breadcrumb}
        meta={<Badge tone="info">In progress</Badge>}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="In this release" description="This screen is being finished. When it lands it will show:">
          <ul className="flex flex-col">
            {coming.map((item) => (
              <li key={item} className="flex items-start gap-2.5 border-t border-line py-2.5 first:border-t-0 first:pt-0 last:pb-0">
                <CircleDashed size={14} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-faint" />
                <span className="text-[13px] leading-5 text-ink">{item}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Related pages" description="Pick up the same work from here today.">
          <nav aria-label="Related pages">
            <ul className="flex flex-col gap-1.5">
              {related.map(({ to, label, hint, icon: Icon }) => (
                <li key={label}>
                  <Link
                    to={to}
                    className="group flex items-center gap-3 rounded-md border border-line px-3 py-2.5 transition-colors duration-150 ease-tm hover:border-line-strong hover:bg-hover"
                  >
                    <Icon size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-dim group-hover:text-primary" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-[13px] font-medium text-ink">{label}</span>
                      <span className="truncate text-xs text-dim">{hint}</span>
                    </span>
                    <ArrowRight
                      size={14}
                      aria-hidden="true"
                      className="shrink-0 text-faint transition-colors duration-150 ease-tm group-hover:text-ink"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </Panel>
      </div>
    </>
  );
}
