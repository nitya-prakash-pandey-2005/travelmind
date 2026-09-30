import { Component, Suspense, lazy, useId, useState, type ReactNode } from "react";
import { cn } from "../../ui/cn";
import { hasWebGL } from "../globe/webgl";
import { POPULAR_ROUTES } from "./popularRoutes";

// three.js is large: the globe arrives in its own chunk after the words are on screen.
const RouteGlobe = lazy(() => import("../globe/RouteGlobe"));

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

/** Busy routes out of the launch markets on a slowly turning globe, with the same routes listed as text. */
export function RoutesGlobe({ className }: { className?: string }) {
  const [webgl] = useState(hasWebGL);
  const captionId = useId();
  return (
    <figure className={cn("flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-bg", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <span id={captionId} className="text-[13px] font-medium text-ink">
          Popular routes
        </span>
        <span className="text-xs text-faint">Illustration</span>
      </div>
      {/* Decorative: the page scrolls (and swipes) straight past it. */}
      <div aria-hidden="true" className="pointer-events-none relative mx-auto aspect-square w-full max-w-[22rem] flex-1">
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
    </figure>
  );
}
