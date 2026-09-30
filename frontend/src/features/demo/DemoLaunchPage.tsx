import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { authApi } from "../../api/auth";
import { asApiError } from "../../api/client";
import { meQueryOptions, qk } from "../../api/queries";
import { APP_HOME } from "../../app/paths";
import { resetSessionState } from "../../auth/resetSessionState";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { Button } from "../../ui/Button";
import { CtaLink } from "../landing/CtaLink";

/** What the server does while the visitor waits (see the demo generator). */
const STEPS = [
  "Creating a private demo agency and team",
  "Adding sample clients and enquiries",
  "Pricing each trip with real sandbox searches",
  "Opening your Command Center",
];

function LaunchMark({ failed }: { failed: boolean }) {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" className="h-24 w-24">
      <circle cx="60" cy="60" r="56" fill="none" stroke="var(--tm-line)" strokeWidth="1" strokeDasharray="2 6" />
      <circle cx="60" cy="60" r="34" fill="none" stroke={failed ? "var(--tm-danger)" : "var(--tm-primary)"} strokeWidth="1.4" />
      <g className={failed ? undefined : "tm-spin-slow"} style={{ transformOrigin: "60px 60px", animationDuration: "6s" }}>
        <ellipse cx="60" cy="60" rx="54" ry="18" fill="none" stroke="var(--tm-ai)" strokeWidth="1" transform="rotate(-24 60 60)" />
        <circle cx="109" cy="40" r="3.5" fill={failed ? "var(--tm-danger)" : "var(--tm-primary)"} />
      </g>
    </svg>
  );
}

/**
 * /demo: one click from the landing page. Creates a private, clearly labelled demo workspace, signs its
 * presenter in from the response and opens the Command Center. Someone already signed in keeps their session.
 */
export function DemoLaunchPage() {
  useDocumentTitle("Preparing your demo — TravelMind");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useQuery(meQueryOptions);
  // One workspace per visit, even when effects run twice (React StrictMode) or `me` refetches.
  const started = useRef(false);
  const demo = useMutation({
    mutationFn: authApi.startDemo,
    meta: { skipAuthRedirect: true },
    onSuccess: async (user) => {
      // A fresh session: nothing cached from an earlier visitor on this browser may leak into it.
      resetSessionState(queryClient);
      queryClient.setQueryData(qk.me, user);
      await navigate({ to: APP_HOME, replace: true });
    },
  });
  const launch = demo.mutate;

  useEffect(() => {
    if (me.isPending || started.current) return;
    started.current = true;
    if (me.data) void navigate({ to: APP_HOME, replace: true });
    else launch();
  }, [me.isPending, me.data, navigate, launch]);

  const error = demo.isError ? asApiError(demo.error) : null;
  const rateLimited = error?.status === 429;

  return (
    <main className="tm-grid tm-scanlines flex min-h-dvh items-center justify-center px-4 py-12 sm:px-6">
      <div className="tm-glass tm-edge relative w-full max-w-lg rounded-lg p-6 sm:p-10">
        <LaunchMark failed={Boolean(error)} />
        {error ? (
          <>
            <h1 className="mt-6 font-display text-2xl font-semibold tracking-wide text-ink sm:text-3xl">
              The demo couldn't start
            </h1>
            <p role="alert" className="mt-3 leading-relaxed text-dim">
              {error.message}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              {rateLimited ? (
                <CtaLink to="/signup">Start free instead</CtaLink>
              ) : (
                <Button onClick={() => launch()}>Try again</Button>
              )}
              <Link to="/" className="text-sm text-dim hover:text-ink">
                Back to the home page
              </Link>
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-6 font-display text-2xl font-semibold tracking-wide text-ink sm:text-3xl">
              Preparing your demo workspace…
            </h1>
            <p className="mt-3 leading-relaxed text-dim">
              A private agency with sample data, labelled as a demo everywhere and removed automatically.
            </p>
            <div
              role="progressbar"
              aria-label="Preparing your demo workspace"
              className="mt-8 h-1 overflow-hidden rounded-full bg-line"
            >
              <div className="tm-progress-sweep h-full rounded-full bg-linear-to-r from-primary to-ai" />
            </div>
            <ol aria-label="Demo setup steps" className="mt-8 flex flex-col gap-3">
              {STEPS.map((step, index) => (
                <li key={step} className="flex items-center gap-3 text-sm text-dim">
                  <span
                    aria-hidden="true"
                    className="tm-tint inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] text-primary"
                  >
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </main>
  );
}
