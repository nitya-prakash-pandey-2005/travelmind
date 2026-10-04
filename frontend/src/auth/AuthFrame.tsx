import { Link } from "@tanstack/react-router";
import { Gauge, ScrollText, Tags } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { FareConsole, Illustration } from "../features/landing/ConsolePreview";
import { DATA_SOURCES, SourceMark } from "../features/landing/IntegrationsStrip";
import { Kicker } from "../features/landing/Kicker";
import { ICON_CHIP } from "../features/landing/layout";
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

/** The product side of the sign-in screens, on the kit's glass chrome: the pitch, a slice of the product with sample data, and its sources. */
function ProductPanel() {
  return (
    <aside
      aria-label="About TravelMind"
      className="relative isolate hidden flex-col justify-center overflow-hidden border-l border-line bg-chrome px-10 py-12 backdrop-blur-[20px] lg:flex xl:px-16"
    >
      <div
        aria-hidden="true"
        className="decor-gradient pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[40rem] w-[40rem] -translate-x-1/2 -translate-y-1/2"
        style={GLOW}
      />
      <div className="mx-auto flex w-full max-w-[36rem] flex-col gap-9">
        <div>
          <Kicker>Operations console</Kicker>
          <p className="font-display text-[26px] font-semibold leading-8 tracking-[-0.02em] text-ink">
            Answer travel enquiries with <span className="grad-text">fares you can explain.</span>
          </p>
          <ul className="mt-5 grid gap-2.5">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-dim">
                <span aria-hidden="true" className={ICON_CHIP}>
                  <Icon size={15} strokeWidth={1.75} />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <Illustration caption="Illustration with sample data, not live fares.">
          <FareConsole className="glow shadow-frame" />
        </Illustration>
        <div className="card">
          <p className="hud">Connects to</p>
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
 * Split layout for sign-in, sign-up and invitations: the form in a kit glass card on the left, the product on the
 * right (from 1024 px), over the kit's ambient glow and HUD grid. `kicker` is the HUD label over the title;
 * `footer` holds the link to the other flow ("New to TravelMind? Create a workspace").
 */
export function AuthFrame({
  kicker,
  title,
  subtitle,
  footer,
  children,
}: {
  kicker: string;
  title: string;
  subtitle: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative isolate grid min-h-dvh bg-bg lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div aria-hidden="true" className="tm-ambient -z-10" />
      <div className="flex min-w-0 flex-col px-4 py-6 sm:px-10">
        <header className="flex items-center justify-between gap-3">
          <Link to="/" className="rounded-sm">
            <Wordmark />
          </Link>
          <ThemeSwitcher hideNameBelow="sm" />
        </header>
        <main className="flex flex-1 items-center justify-center py-8 sm:py-10">
          <div className="card glow w-full max-w-[26rem] p-5 sm:p-7">
            <Kicker>{kicker}</Kicker>
            <h1 className="font-display text-[24px] font-semibold leading-8 tracking-[-0.02em] text-ink">{title}</h1>
            <p className="mb-6 mt-1.5 text-sm leading-5 text-dim">{subtitle}</p>
            {children}
            {footer && <div className="mt-6 border-t border-line pt-5 text-[13px] text-dim">{footer}</div>}
          </div>
        </main>
        <p className="pill-src">© 2026 TravelMind</p>
      </div>
      <ProductPanel />
    </div>
  );
}

/** The footer link style shared by the three auth pages. */
export const AUTH_LINK = "rounded-sm font-medium text-primary hover:underline";
