/**
 * Shown while a route's guard or data is still loading, so a slow API never leaves a blank screen: a kit glass chip
 * with a spinner in the accent (still under reduced motion) over the ambient glow.
 */
export function PageLoading() {
  return (
    <div role="status" aria-live="polite" className="relative isolate grid min-h-dvh place-items-center bg-bg p-4">
      <div aria-hidden="true" className="tm-ambient -z-10" />
      <div className="card tight flex items-center gap-3 text-sm text-dim">
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-line-soft border-t-primary motion-reduce:animate-none"
        />
        <span>
          Loading <span className="font-display font-semibold text-ink">TravelMind</span>…
        </span>
      </div>
    </div>
  );
}
