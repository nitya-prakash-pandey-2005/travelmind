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
      <div aria-hidden="true" className="tm-dot-grid tm-grid-fade absolute inset-0 -z-10" />
      <header>
        <Link to="/" className="rounded-sm">
          <Wordmark />
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center py-10">
        <div className="w-full max-w-md rounded-lg border border-line bg-surface">
          {error ? (
            <div className="p-6">
              <span
                aria-hidden="true"
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-danger/40 bg-danger/10 text-danger"
              >
                <CircleAlert size={18} strokeWidth={1.75} />
              </span>
              <h1 className="mt-4 text-lg font-semibold text-ink">The demo couldn't start</h1>
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
                <p className="flex items-center gap-2 text-[13px] text-dim">
                  <span aria-hidden="true" className="tm-live h-1.5 w-1.5 rounded-full bg-warn text-warn" />
                  Demo workspace
                </p>
                <h1 className="mt-3 text-lg font-semibold text-ink">Preparing your demo workspace…</h1>
                <p className="mt-1.5 text-sm leading-6 text-dim">
                  A private agency with sample data, labelled as a demo on every screen and deleted after 7 days. Pricing
                  the sample trips can take a minute.
                </p>
                <div
                  role="progressbar"
                  aria-label="Preparing your demo workspace"
                  className="mt-5 h-1 overflow-hidden rounded-full bg-surface-2"
                >
                  <div className="tm-progress-sweep h-full rounded-full bg-primary" />
                </div>
              </div>
              <div className="border-t border-line px-6 py-5">
                <p className="tm-micro">What happens now</p>
                <ol aria-label="Demo setup steps" className="mt-3 flex flex-col gap-2.5">
                  {STEPS.map((step, index) => (
                    <li key={step} className="flex items-center gap-3 text-[13px] text-dim">
                      <span aria-hidden="true" className="w-4 shrink-0 font-mono text-xs text-faint">
                        {index + 1}
                      </span>
                      {step}
                    </li>
                  ))}
                </ol>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-line px-6 py-3 font-mono text-xs text-faint">
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
