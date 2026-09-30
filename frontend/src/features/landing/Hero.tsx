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
      <circle cx="100" cy="100" r="62" fill="none" stroke="var(--tm-globe-land)" strokeWidth="1" />
      <ellipse cx="100" cy="100" rx="62" ry="22" fill="none" stroke="var(--tm-line)" strokeWidth="0.8" />
      <ellipse cx="100" cy="100" rx="24" ry="62" fill="none" stroke="var(--tm-line)" strokeWidth="0.8" />
      <path d="M62 86 Q 96 40 138 78" fill="none" stroke="var(--tm-primary)" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M70 118 Q 110 84 146 112" fill="none" stroke="var(--tm-ai)" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="62" cy="86" r="2.4" fill="var(--tm-primary)" />
      <circle cx="138" cy="78" r="2.4" fill="var(--tm-primary)" />
      <circle cx="70" cy="118" r="2.2" fill="var(--tm-ai)" />
      <circle cx="146" cy="112" r="2.2" fill="var(--tm-ai)" />
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

/** Instrument reticle drawn around the globe: range rings, bearing ticks and crosshair marks. */
function Reticle() {
  const ticks = Array.from({ length: 72 }, (_, index) => index * 5);
  return (
    <svg viewBox="0 0 400 400" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full">
      <circle cx="200" cy="200" r="196" fill="none" stroke="var(--tm-line)" strokeWidth="1" />
      <circle cx="200" cy="200" r="172" fill="none" stroke="var(--tm-line)" strokeWidth="1" strokeDasharray="2 7" />
      <g>
        {ticks.map((deg) => (
          <line
            key={deg}
            x1="200"
            y1={deg % 45 === 0 ? 4 : 10}
            x2="200"
            y2="18"
            stroke={deg % 45 === 0 ? "var(--tm-primary)" : "var(--tm-line)"}
            strokeWidth={deg % 45 === 0 ? 1.5 : 1}
            transform={`rotate(${deg} 200 200)`}
          />
        ))}
      </g>
      {[0, 90, 180, 270].map((deg) => (
        <path
          key={deg}
          d="M200 26 v14"
          stroke="var(--tm-primary)"
          strokeWidth="1.5"
          strokeLinecap="round"
          transform={`rotate(${deg} 200 200)`}
        />
      ))}
    </svg>
  );
}

function HeroGlobe() {
  const [webgl] = useState(hasWebGL);
  const captionId = useId();
  return (
    <figure className="tm-fade-in relative mx-auto flex w-full max-w-[34rem] flex-col items-center" style={{ animationDuration: "1200ms" }}>
      <div className="relative aspect-square w-full">
        <div aria-hidden="true" className="tm-hero-glow absolute inset-[4%] rounded-full" />
        <Reticle />
        {/* Decorative: the page scrolls (and swipes) straight past it. */}
        <div className="pointer-events-none absolute inset-[7%]">
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
      </div>
      <figcaption className="mt-2 w-full text-center">
        <p id={captionId} className="font-display text-sm tracking-wide text-ink">
          Popular routes
        </p>
        <p className="mt-0.5 text-xs text-dim">For illustration. Your own enquiry routes appear in the Command Center.</p>
        <ul aria-labelledby={captionId} className="mt-3 flex flex-wrap justify-center gap-1.5">
          {POPULAR_ROUTES.map(({ from, to }) => (
            <li
              key={`${from.iata_code}-${to.iata_code}`}
              className="rounded-sm border border-line bg-void/40 px-2 py-0.5 font-mono text-xs text-dim"
            >
              <span className="sr-only">
                {from.city} to {to.city},{" "}
              </span>
              {from.iata_code} → {to.iata_code}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

export function Hero() {
  return (
    <section aria-labelledby="landing-title" className="relative isolate overflow-hidden">
      <div aria-hidden="true" className="tm-grid tm-grid-fade absolute inset-0 -z-10" />
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 pb-16 pt-12 sm:px-6 sm:pt-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-10 lg:pb-24 lg:pt-20">
        <div className="min-w-0">
          <p className="tm-rise mb-6 inline-flex rounded-sm border border-line bg-void/40 px-2.5 py-1 text-xs text-dim" style={enter(0)}>
            For travel agencies and corporate travel desks
          </p>
          <h1
            id="landing-title"
            className="tm-rise font-display text-[2.5rem] font-semibold leading-[1.02] tracking-[-0.01em] text-balance text-ink sm:text-6xl lg:text-[4.5rem]"
            style={enter(1)}
          >
            The mission control for modern travel agencies
          </h1>
          <p className="tm-rise mt-6 max-w-[34rem] text-lg leading-relaxed text-dim" style={enter(2)}>
            Search live airline and hotel inventory, see what every fare really means, and send polished quotes in
            minutes — every price labelled with where it came from.
          </p>
          <div className="tm-rise mt-9 flex flex-col gap-3 sm:flex-row sm:items-center" style={enter(3)}>
            <CtaLink to="/demo" size="lg">
              Explore live demo
            </CtaLink>
            <CtaLink to="/signup" size="lg" variant="ghost">
              Start free
            </CtaLink>
          </div>
          <p className="tm-rise mt-4 text-sm text-dim" style={enter(4)}>
            The demo opens a private workspace with sample data. No sign-up needed.
          </p>
        </div>
        <HeroGlobe />
      </div>
    </section>
  );
}
