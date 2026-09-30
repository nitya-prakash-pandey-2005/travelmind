import type { QueryClient } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { meQueryOptions } from "./api/queries";
import { setUnauthorizedHandler } from "./api/queryClient";
import { NotFound } from "./app/NotFound";
import { RootRouteError } from "./app/RouteError";
import { AcceptInvitePage } from "./auth/AcceptInvitePage";
import { LoginPage } from "./auth/LoginPage";
import { resetSessionState } from "./auth/resetSessionState";
import { SignupPage } from "./auth/SignupPage";
import { MissionControlPage } from "./features/dashboard/MissionControlPage";
import { FareScanPage } from "./features/fares/FareScanPage";
import { HotelScanPage } from "./features/hotels/HotelScanPage";
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

const redirectIfSignedIn = async ({ context }: { context: RouterContext }) => {
  if (await context.queryClient.ensureQueryData(meQueryOptions)) throw redirect({ to: "/" });
};

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

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions);
    if (!me) throw redirect({ to: "/login", search: { redirect: location.href } });
  },
  component: AppShell,
});

const missionRoute = createRoute({ getParentRoute: () => appRoute, path: "/", component: MissionControlPage });
const teamRoute = createRoute({ getParentRoute: () => appRoute, path: "/team", component: TeamPage });
const designRoute = createRoute({ getParentRoute: () => appRoute, path: "/design", component: DesignGallery });
const faresRoute = createRoute({ getParentRoute: () => appRoute, path: "/fares", component: FareScanPage });
const hotelsRoute = createRoute({ getParentRoute: () => appRoute, path: "/hotels", component: HotelScanPage });
const suppliersRoute = createRoute({ getParentRoute: () => appRoute, path: "/suppliers", component: SuppliersPage });

export const routeTree = rootRoute.addChildren([
  loginRoute,
  signupRoute,
  inviteRoute,
  appRoute.addChildren([missionRoute, faresRoute, hotelsRoute, suppliersRoute, teamRoute, designRoute]),
]);

const PUBLIC_PREFIXES = ["/login", "/signup", "/invite/"];

export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history,
    defaultPreload: "intent",
    defaultPendingMinMs: 0,
  });
  // Registered here (not in api/queryClient) so the api layer never imports feature state.
  setUnauthorizedHandler(() => {
    resetSessionState(queryClient);
    const { pathname, href } = router.state.location;
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
