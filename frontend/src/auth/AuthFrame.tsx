import { Link } from "@tanstack/react-router";
import { Gauge, ScrollText, Tags } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { FareConsole, Illustration } from "../features/landing/ConsolePreview";
import { DATA_SOURCES, SourceMark } from "../features/landing/IntegrationsStrip";
import { Wordmark } from "../features/landing/Wordmark";
import { ThemeSwitcher } from "../theme/ThemeSwitcher";

const POINTS = [
  { icon: Tags, text: "Every price labelled Live, Cached or Sandbox" },
  { icon: Gauge, text: "Fare insight against the route's recorded fares" },
  { icon: ScrollText, text: "Roles, tenant isolation and an audit log" },
];

const GLOW: CSSProperties = {
  background: "radial-gradient(closest-side, color-mix(in oklab, var(--tm-primary) 13%, transparent), transparent)",
};

/** The product side of the sign-in screens: the pitch, a slice of the product with sample data, and its sources. */
function ProductPanel() {
  return (
    <aside
      aria-label="About TravelMind"
      className="relative isolate hidden flex-col justify-center overflow-hidden border-l border-line bg-surface px-10 py-12 lg:flex xl:px-16"
    >
      <div aria-hidden="true" className="tm-dot-grid tm-grid-fade absolute inset-0 -z-20" />
      <div
        aria-hidden="true"
        className="decor-gradient pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[40rem] w-[40rem] -translate-x-1/2 -translate-y-1/2"
        style={GLOW}
      />
      <div className="mx-auto flex w-full max-w-[36rem] flex-col gap-9">
        <div>
          <p className="text-2xl font-semibold leading-8 tracking-[-0.015em] text-ink">
            Answer travel enquiries with fares you can explain.
          </p>
          <ul className="mt-5 grid gap-2.5">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-dim">
                <span
                  aria-hidden="true"
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line-strong bg-bg text-primary"
                >
                  <Icon size={13} strokeWidth={1.75} />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <Illustration caption="Illustration with sample data, not live fares.">
          <FareConsole className="shadow-frame" />
        </Illustration>
        <div className="border-t border-line pt-6">
          <p className="text-[13px] font-medium text-ink">Connects to</p>
          <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 xl:grid-cols-3">
            {DATA_SOURCES.map((source) => (
              <li key={source.name} className="min-w-0">
                <SourceMark source={source} size="sm" />
              </li>
            ))}
          </ul>
        </div>
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
    <div className="grid min-h-dvh bg-bg lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex min-w-0 flex-col px-4 py-6 sm:px-10">
        <header className="flex items-center justify-between gap-3">
          <Link to="/" className="rounded-sm">
            <Wordmark />
          </Link>
          <ThemeSwitcher hideNameBelow="sm" />
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
