import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { useId } from "react";
import { asApiError } from "../api/client";
import { Button } from "../ui/Button";
import { FormError } from "../ui/FormError";

export function RouteError({ error, reset }: { error: unknown; reset: () => void }) {
  const titleId = useId();
  return (
    <div className="grid min-h-dvh place-items-center bg-bg p-4">
      <section
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-lg border border-line bg-surface p-5"
      >
        <div className="mb-4 flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-danger/30 bg-danger/10 text-danger"
          >
            <TriangleAlert size={16} strokeWidth={1.75} />
          </span>
          <h2 id={titleId} className="min-w-0 text-base font-semibold leading-6 text-ink">
            This page couldn't load
          </h2>
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
