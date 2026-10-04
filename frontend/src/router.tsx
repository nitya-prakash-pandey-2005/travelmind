import type { QueryClient } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { isDashboardRange, type DashboardRange } from "./api/dashboard";
import { meQueryOptions } from "./api/queries";
import { setUnauthorizedHandler } from "./api/queryClient";
import { NotFound } from "./app/NotFound";
import { PageLoading } from "./app/PageLoading";
import { RootRouteError } from "./app/RouteError";
import { APP_HOME } from "./app/paths";
import { AcceptInvitePage } from "./auth/AcceptInvitePage";
import { LoginPage } from "./auth/LoginPage";
import { resetSessionState } from "./auth/resetSessionState";
import { SignupPage } from "./auth/SignupPage";
import { AgentPage } from "./features/agent/AgentPage";
import { validateAgentSearch } from "./features/agent/agentText";
import { ClientPage } from "./features/clients/ClientPage";
import { ClientsPage } from "./features/clients/ClientsPage";
import { CommandCenterPage } from "./features/command/CommandCenterPage";
import { DemoLaunchPage } from "./features/demo/DemoLaunchPage";
import { FareScanPage } from "./features/fares/FareScanPage";
import { validateFareSearch } from "./features/fares/fareSearchParams";
import { EnquiryPage } from "./features/enquiries/EnquiryPage";
import { HotelScanPage } from "./features/hotels/HotelScanPage";
import { LandingPage } from "./features/landing/LandingPage";
import { PipelinePage } from "./features/pipeline/PipelinePage";
import { PublicQuotePage } from "./features/publicQuote/PublicQuotePage";
import { QuoteEditorPage } from "./features/quotes/QuoteEditorPage";
import { QuotesPage } from "./features/quotes/QuotesPage";
import { RouteIntelPage } from "./features/routes/RouteIntelPage";
import { validateRouteIntelSearch } from "./features/routes/routeIntelParams";
import { SettingsPage } from "./features/settings/SettingsPage";
import { SuppliersPage } from "./features/suppliers/SuppliersPage";
import { TeamPage } from "./features/team/TeamPage";
import { AppShell } from "./shell/AppShell";
import { DesignGallery } from "./ui/DesignGallery";

export type RouterContext = { queryClient: QueryClient };

/**
 * Browsers read "\" as "/" and strip tabs/newlines from URLs, so "/\evil.example" or "/<TAB>/evil.example"
 * can become protocol-relative. Reject backslashes, space, C0 controls and DEL outright.
 */
function hasUrlTrickChars(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (char === "\\" || code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Only same-site paths: "/team?tab=crew" is fine; "//evil.example", "https://…", "/\evil.example" are not.
 * The value is also resolved against our origin and must stay on it.
 */
export function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return undefined;
  if (hasUrlTrickChars(value)) return undefined;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return undefined;
    // Dot segments can normalise to a protocol-relative path: "/.//evil.example" → "//evil.example".
    const path = url.pathname + url.search + url.hash;
    return path.startsWith("//") ? undefined : path;
  } catch {
    return undefined;
  }
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  errorComponent: RootRouteError,
  notFoundComponent: NotFound,
});

/** How long a public page waits for the session check before showing itself as signed out. */
export const SESSION_CHECK_MS = 2500;

/**
 * Public pages send signed-in visitors to the app, but never wait on — or fail because of — the
 * session check: a slow or failing API shows the page as signed out instead of a blank screen.
 */
const redirectIfSignedIn = async ({ context }: { context: RouterContext }) => {
  const me = await Promise.race([
    context.queryClient.ensureQueryData({ ...meQueryOptions, retry: false }).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), SESSION_CHECK_MS)),
  ]);
  if (me) throw redirect({ to: APP_HOME });
};

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: redirectIfSignedIn,
  component: LandingPage,
});

// No beforeLoad: the page shows its progress straight away and checks for an existing session itself.
const demoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/demo",
  component: DemoLaunchPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  // The router merges this result over the raw query, so the key must be overwritten (not
  // omitted) for an unsafe value like "//evil.example" to be dropped.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: safeRedirect(search.redirect),
  }),
  beforeLoad: redirectIfSignedIn,
  component: LoginPage,
});

const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/signup",
  beforeLoad: redirectIfSignedIn,
  component: SignupPage,
});

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite/$token",
  component: AcceptInvitePage,
});

/** The client's quote page: public, outside the app shell, never checks or needs a session. */
const publicQuoteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/q/$token",
  component: PublicQuotePage,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app",
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions);
    if (!me) throw redirect({ to: "/login", search: { redirect: location.href } });
  },
  component: AppShell,
});

const commandRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  // The dashboard range lives in the URL (?range=7d|30d|90d); anything else falls back to the default.
  validateSearch: (search: Record<string, unknown>): { range?: DashboardRange } => ({
    range: isDashboardRange(search.range) ? search.range : undefined,
  }),
  component: CommandCenterPage,
});
const teamRoute = createRoute({ getParentRoute: () => appRoute, path: "/team", component: TeamPage });
const designRoute = createRoute({ getParentRoute: () => appRoute, path: "/design", component: DesignGallery });
const faresRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/fares",
  validateSearch: validateFareSearch,
  component: FareScanPage,
});
const hotelsRoute = createRoute({ getParentRoute: () => appRoute, path: "/hotels", component: HotelScanPage });
const suppliersRoute = createRoute({ getParentRoute: () => appRoute, path: "/suppliers", component: SuppliersPage });
const pipelineRoute = createRoute({ getParentRoute: () => appRoute, path: "/pipeline", component: PipelinePage });
const enquiryRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/enquiries/$enquiryId",
  component: EnquiryPage,
});
const quotesRoute = createRoute({ getParentRoute: () => appRoute, path: "/quotes", component: QuotesPage });
const quoteRoute = createRoute({ getParentRoute: () => appRoute, path: "/quotes/$quoteId", component: QuoteEditorPage });
const clientsRoute = createRoute({ getParentRoute: () => appRoute, path: "/clients", component: ClientsPage });
const clientRoute = createRoute({ getParentRoute: () => appRoute, path: "/clients/$clientId", component: ClientPage });
const routeIntelRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/routes",
  validateSearch: validateRouteIntelSearch,
  component: RouteIntelPage,
});
const agentRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/agent",
  // ?prompt= prefills the request box (e.g. "Plan with agent" on an enquiry); it is never sent by itself.
  validateSearch: validateAgentSearch,
  component: AgentPage,
});
const agentRunRoute = createRoute({ getParentRoute: () => appRoute, path: "/agent/$runId", component: AgentPage });
const settingsRoute = createRoute({ getParentRoute: () => appRoute, path: "/settings", component: SettingsPage });

/** Pre-/app addresses (bookmarks, old links) move to their new home with their query and hash intact. */
function legacyRedirect(path: "/fares" | "/hotels" | "/suppliers" | "/team" | "/design") {
  return createRoute({
    getParentRoute: () => rootRoute,
    path,
    beforeLoad: ({ location }) => {
      const hash = location.hash ? `#${location.hash}` : "";
      throw redirect({ href: `${APP_HOME}${path}${location.searchStr}${hash}`, replace: true });
    },
  });
}

export const routeTree = rootRoute.addChildren([
  homeRoute,
  demoRoute,
  loginRoute,
  signupRoute,
  inviteRoute,
  publicQuoteRoute,
  appRoute.addChildren([
    commandRoute,
    pipelineRoute,
    enquiryRoute,
    quotesRoute,
    quoteRoute,
    clientsRoute,
    clientRoute,
    agentRoute,
    agentRunRoute,
    faresRoute,
    hotelsRoute,
    routeIntelRoute,
    suppliersRoute,
    teamRoute,
    settingsRoute,
    designRoute,
  ]),
  legacyRedirect("/fares"),
  legacyRedirect("/hotels"),
  legacyRedirect("/suppliers"),
  legacyRedirect("/team"),
  legacyRedirect("/design"),
]);

/** Public pages: an expired session there needs no trip to the login page. */
const PUBLIC_PATHS = ["/", "/demo"];
const PUBLIC_PREFIXES = ["/login", "/signup", "/invite/", "/q/"];

export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history,
    defaultPreload: "intent",
    defaultPendingMinMs: 0,
    defaultPendingMs: 300,
    defaultPendingComponent: PageLoading,
  });
  // Registered here (not in api/queryClient) so the api layer never imports feature state.
  setUnauthorizedHandler(() => {
    resetSessionState(queryClient);
    const { pathname, href } = router.state.location;
    if (PUBLIC_PATHS.includes(pathname)) return;
    if (PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) return;
    void router.navigate({ to: "/login", search: { redirect: href } });
  });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
