import { Component, Suspense, lazy, useId, useState, type CSSProperties, type ReactNode } from "react";
import { hasWebGL } from "../globe/webgl";
import { CtaLink } from "./CtaLink";
import { POPULAR_ROUTES } from "./popularRoutes";

// three.js is large: the globe arrives in its own chunk after the words are on screen.
const RouteGlobe = lazy(() => import("../globe/RouteGlobe"));

const enter = (index: number) => ({ "--tm-enter-index": index }) as CSSProperties;

/** Drawn instead of the 3D globe while it loads, on devices without WebGL, and if the GPU gives up. */
function OrbitalSketch() {
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true" className="h-full w-full">
      <circle cx="100" cy="100" r="70" fill="none" stroke="var(--tm-globe-land)" strokeWidth="1" />
      <ellipse cx="100" cy="100" rx="70" ry="24" fill="none" stroke="var(--tm-border)" strokeWidth="1" />
      <ellipse cx="100" cy="100" rx="28" ry="70" fill="none" stroke="var(--tm-border)" strokeWidth="1" />
      <path d="M64 88 Q 98 46 140 80" fill="none" stroke="var(--tm-primary)" strokeWidth="1" strokeLinecap="round" />
      <path d="M72 118 Q 110 90 146 114" fill="none" stroke="var(--tm-primary)" strokeOpacity="0.5" strokeWidth="1" strokeLinecap="round" />
      <circle cx="64" cy="88" r="2" fill="var(--tm-primary)" />
      <circle cx="140" cy="80" r="2" fill="var(--tm-primary)" />
      <circle cx="72" cy="118" r="2" fill="var(--tm-text-2)" />
      <circle cx="146" cy="114" r="2" fill="var(--tm-text-2)" />
    </svg>
  );
}

/** A WebGL/GPU failure falls back to the sketch; the rest of the page never notices. */
class GlobeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <OrbitalSketch /> : this.props.children;
  }
}

/** Four small corner ticks: the one instrument-frame flourish the design direction allows (hero globe only). */
function CornerTicks() {
  const tick = "pointer-events-none absolute h-2.5 w-2.5 border-primary/70";
  return (
    <>
      <span aria-hidden="true" className={`${tick} left-0 top-0 border-l border-t`} />
      <span aria-hidden="true" className={`${tick} right-0 top-0 border-r border-t`} />
      <span aria-hidden="true" className={`${tick} bottom-0 left-0 border-b border-l`} />
      <span aria-hidden="true" className={`${tick} bottom-0 right-0 border-b border-r`} />
    </>
  );
}

function HeroGlobe() {
  const [webgl] = useState(hasWebGL);
  const captionId = useId();
  return (
    <figure className="tm-rise relative mx-auto w-full max-w-[32rem] p-1.5" style={enter(3)}>
      <CornerTicks />
      <div className="overflow-hidden rounded-lg border border-line bg-bg/60">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <span id={captionId} className="text-[13px] font-medium text-ink">
            Popular routes
          </span>
          <span className="text-xs text-faint">Illustration</span>
        </div>
        {/* Decorative: the page scrolls (and swipes) straight past it. */}
        <div aria-hidden="true" className="pointer-events-none relative mx-auto aspect-square w-[88%]">
          {webgl ? (
            <GlobeBoundary>
              <Suspense fallback={<OrbitalSketch />}>
                <RouteGlobe arcs={POPULAR_ROUTES} showcase />
              </Suspense>
            </GlobeBoundary>
          ) : (
            <OrbitalSketch />
          )}
        </div>
        <figcaption className="border-t border-line px-4 py-3">
          <ul aria-labelledby={captionId} className="flex flex-wrap gap-1.5">
            {POPULAR_ROUTES.map(({ from, to }) => (
              <li
                key={`${from.iata_code}-${to.iata_code}`}
                className="rounded-[4px] border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] text-dim"
              >
                <span className="sr-only">
                  {from.city} to {to.city},{" "}
                </span>
                {from.iata_code} → {to.iata_code}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-faint">Busy routes from our launch markets. Your own routes appear in the Command Center.</p>
        </figcaption>
      </div>
    </figure>
  );
}

const HERO_TITLE = "Answer travel enquiries with fares you can explain";
const HERO_LEAD =
  "TravelMind searches your airline and hotel suppliers in one pass, shows whether each fare is good for its route, and keeps every enquiry in one pipeline. Every price says whether it is live, cached or sandbox.";

export function Hero() {
  return (
    <section aria-labelledby="landing-title" className="relative isolate overflow-hidden border-b border-line">
      <div aria-hidden="true" className="tm-dot-grid tm-grid-fade absolute inset-0 -z-10" />
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-16 lg:pb-24 lg:pt-24">
        <div className="min-w-0">
          <p className="tm-rise mb-5 text-[13px] text-dim" style={enter(0)}>
            For travel management companies and agency teams
          </p>
          <h1
            id="landing-title"
            className="tm-rise max-w-[16ch] text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.02em] text-ink sm:text-[3.25rem] lg:text-[3.5rem]"
            style={enter(1)}
          >
            {HERO_TITLE}
          </h1>
          <p className="tm-rise mt-6 max-w-[36rem] text-base leading-7 text-dim sm:text-[17px]" style={enter(2)}>
            {HERO_LEAD}
          </p>
          <div className="tm-rise mt-8 flex flex-col gap-3 sm:flex-row sm:items-center" style={enter(3)}>
            <CtaLink to="/demo" size="lg">
              Open demo workspace
            </CtaLink>
            <CtaLink to="/signup" size="lg" variant="secondary">
              Create workspace
            </CtaLink>
          </div>
          <p className="tm-rise mt-4 text-[13px] text-faint" style={enter(4)}>
            The demo is a private workspace with sample data. No sign-up; deleted after 7 days.
          </p>
        </div>
        <HeroGlobe />
      </div>
    </section>
  );
}
