import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { useId } from "react";
import { asApiError } from "../api/client";
import { Button } from "../ui/Button";
import { FormError } from "../ui/FormError";

export function RouteError({ error, reset }: { error: unknown; reset: () => void }) {
  const titleId = useId();
  return (
    <div className="relative isolate grid min-h-dvh place-items-center bg-bg p-4">
      <div aria-hidden="true" className="tm-ambient -z-10" />
      <section aria-labelledby={titleId} className="card w-full max-w-md p-6">
        <div className="mb-4 flex items-center gap-3">
          <span
            aria-hidden="true"
            className="tone-fill grid h-9 w-9 shrink-0 place-items-center rounded-[11px] border text-danger"
          >
            <TriangleAlert size={17} strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <p className="hud">Something went wrong</p>
            <h2 id={titleId} className="font-display text-base font-semibold leading-6 text-ink">
              This page couldn't load
            </h2>
          </div>
        </div>
        <FormError error={asApiError(error)} />
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={reset}>
            Try again
          </Button>
        </div>
      </section>
    </div>
  );
}

/**
 * Root error boundary. `reset()` alone re-renders the failed match, which still holds the error,
 * so "Try again" also invalidates the router to re-run the guards/loaders that failed.
 */
export function RootRouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <RouteError
      error={error}
      reset={() => {
        reset();
        void router.invalidate();
      }}
    />
  );
}
