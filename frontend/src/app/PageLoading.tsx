/** Shown while a route's guard or data is still loading, so a slow API never leaves a blank screen. */
export function PageLoading() {
  return (
    <div role="status" aria-live="polite" className="grid min-h-dvh place-items-center bg-bg p-4">
      <div className="flex items-center gap-3 text-sm text-dim">
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-primary motion-reduce:animate-none"
        />
        Loading TravelMind…
      </div>
    </div>
  );
}
