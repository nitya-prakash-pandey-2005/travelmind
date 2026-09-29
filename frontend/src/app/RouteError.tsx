import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { asApiError } from "../api/client";
import { Button } from "../ui/Button";
import { FormError } from "../ui/FormError";
import { Panel } from "../ui/Panel";

export function RouteError({ error, reset }: { error: unknown; reset: () => void }) {
  return (
    <div className="tm-grid flex min-h-dvh items-center justify-center p-6">
      <Panel className="w-full max-w-lg" eyebrow="Fault" title="This view hit a problem">
        <div className="flex flex-col gap-4">
          <FormError error={asApiError(error)} />
          <Button variant="ghost" onClick={reset}>
            Try again
          </Button>
        </div>
      </Panel>
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
