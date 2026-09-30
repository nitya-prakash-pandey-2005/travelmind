import { Link } from "@tanstack/react-router";
import { Gauge, ScrollText, Tags } from "lucide-react";
import type { ReactNode } from "react";
import { FareRowsPreview } from "../features/landing/ConsolePreview";
import { Wordmark } from "../features/landing/Wordmark";
import { ThemeToggle } from "../ui/ThemeToggle";

const POINTS = [
  { icon: Tags, text: "Every price labelled Live, Cached or Sandbox" },
  { icon: Gauge, text: "Fare insight against the route's recorded fares" },
  { icon: ScrollText, text: "Roles, tenant isolation and an audit log" },
];

/** The product side of the sign-in screens: what the workspace looks like, drawn with sample data. */
function ProductPanel() {
  return (
    <aside
      aria-label="About TravelMind"
      className="relative isolate hidden flex-col justify-between gap-10 overflow-hidden border-l border-line bg-surface p-10 lg:flex xl:p-14"
    >
      <div aria-hidden="true" className="tm-dot-grid tm-grid-fade absolute inset-0 -z-10" />
      <div className="max-w-md">
        <p className="text-[22px] font-semibold leading-7 tracking-[-0.01em] text-ink">
          Answer travel enquiries with fares you can explain.
        </p>
        <ul className="mt-6 flex flex-col gap-3">
          {POINTS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-sm text-dim">
              <Icon size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-primary" />
              {text}
            </li>
          ))}
        </ul>
      </div>
      <div className="max-w-lg">
        <FareRowsPreview caption="Illustration with sample data, not live fares." />
      </div>
    </aside>
  );
}

/**
 * Split layout for sign-in, sign-up and invitations: the form on the left, the product on the right
 * (from 1024 px). `footer` holds the link to the other flow ("New to TravelMind? Create a workspace").
 */
export function AuthFrame({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string;
  subtitle: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh bg-bg lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex min-w-0 flex-col px-4 py-6 sm:px-10">
        <header className="flex items-center justify-between gap-3">
          <Link to="/" className="rounded-sm">
            <Wordmark />
          </Link>
          <ThemeToggle />
        </header>
        <main className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">
            <h1 className="text-[22px] font-semibold leading-7 tracking-[-0.01em] text-ink">{title}</h1>
            <p className="mb-7 mt-1.5 text-sm leading-5 text-dim">{subtitle}</p>
            {children}
            {footer && <div className="mt-6 border-t border-line pt-5 text-[13px] text-dim">{footer}</div>}
          </div>
        </main>
        <p className="text-xs text-faint">© 2026 TravelMind</p>
      </div>
      <ProductPanel />
    </div>
  );
}

/** The footer link style shared by the three auth pages. */
export const AUTH_LINK = "rounded-sm font-medium text-primary hover:underline";
