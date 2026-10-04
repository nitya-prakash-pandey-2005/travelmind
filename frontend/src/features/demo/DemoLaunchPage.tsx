import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { CircleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { authApi } from "../../api/auth";
import { asApiError } from "../../api/client";
import { meQueryOptions, qk } from "../../api/queries";
import { APP_HOME } from "../../app/paths";
import { resetSessionState } from "../../auth/resetSessionState";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { Button } from "../../ui/Button";
import { CtaLink } from "../landing/CtaLink";
import { Wordmark } from "../landing/Wordmark";

/**
 * What the server does while the visitor waits (see the demo generator). It answers once, at the end,
 * so the list says what happens rather than pretending to track each step.
 */
const STEPS = [
  "Create a private demo agency and team",
  "Add sample clients and enquiries",
  "Price each trip with real sandbox searches",
  "Open the Command Center",
];

/** The current time, ticking once a second while `running`: drives the elapsed readout. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
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
  const now = useNow(demo.isPending);
  const elapsed = demo.submittedAt > 0 ? Math.max(0, Math.floor((now - demo.submittedAt) / 1000)) : 0;

  return (
    <div className="relative isolate flex min-h-dvh flex-col bg-bg px-4 py-6 sm:px-10">
      <div aria-hidden="true" className="tm-ambient -z-10" />
      <header>
        <Link to="/" className="rounded-sm">
          <Wordmark />
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center py-10">
        <div className="card glow flush w-full max-w-md">
          {error ? (
            <div className="p-6">
              <span aria-hidden="true" className="tone-fill inline-flex h-10 w-10 items-center justify-center rounded-[12px] border text-danger">
                <CircleAlert size={18} strokeWidth={1.75} />
              </span>
              <h1 className="mt-4 font-display text-xl font-semibold text-ink">The demo couldn't start</h1>
              <p role="alert" className="mt-1.5 text-sm leading-6 text-dim">
                {error.message}
              </p>
              {error.traceId && <p className="mt-2 font-mono text-xs text-faint">Trace ID: {error.traceId}</p>}
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
                {rateLimited ? (
                  <CtaLink to="/signup">Create a workspace instead</CtaLink>
                ) : (
                  <Button onClick={() => launch()}>Try again</Button>
                )}
                <Link to="/" className="rounded-sm text-[13px] text-dim hover:text-ink">
                  Back to the home page
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div className="p-6">
                <p className="hud c-amber flex items-center gap-2">
                  <span aria-hidden="true" className="pulse-dot h-1.5 w-1.5 text-warn" />
                  Demo workspace
                </p>
                <h1 className="mt-3 font-display text-xl font-semibold tracking-[-0.02em] text-ink">Preparing your demo workspace…</h1>
                <p className="mt-1.5 text-sm leading-6 text-dim">
                  A private agency with sample data, labelled as a demo on every screen and deleted after 7 days. Pricing
                  the sample trips can take a minute.
                </p>
                {/* The kit progress bar, sweeping: the server answers once, at the end, so there is no percentage. */}
                <div role="progressbar" aria-label="Preparing your demo workspace" className="progress mt-5 h-1.5">
                  <i className="tm-progress-sweep" />
                </div>
              </div>
              <div className="border-t border-line px-6 py-5">
                <p className="hud">What happens now</p>
                <ol aria-label="Demo setup steps" className="list mt-2">
                  {STEPS.map((step, index) => (
                    <li key={step} className="li gap-3 py-2.5 text-[13px] text-dim">
                      <span
                        aria-hidden="true"
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line-soft bg-card-2 bg-(image:--tm-grad-soft) font-display text-xs font-semibold text-primary"
                      >
                        {index + 1}
                      </span>
                      {step}
                    </li>
                  ))}
                </ol>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-line bg-chrome px-6 py-3 font-mono text-xs text-faint">
                <span>Sandbox inventory · not bookable</span>
                <span className="tabular-nums">Elapsed {formatElapsed(elapsed)}</span>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
