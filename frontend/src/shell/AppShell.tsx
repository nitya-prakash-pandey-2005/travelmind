import { Outlet } from "@tanstack/react-router";
import { useId, useSyncExternalStore, type CSSProperties } from "react";
import { useCurrentUser } from "../auth/useCurrentUser";
import { BottomTabs } from "./BottomTabs";
import { DemoBanner } from "./DemoBanner";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";

/** The kit's phone breakpoint: at 900 px and below the sidebar gives way to the bottom tab bar. */
const PHONE = "(max-width: 900px)";

function subscribePhone(callback: () => void): () => void {
  const media = window.matchMedia(PHONE);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

/** True at 900 px and below (the kit's phone layout). */
export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE).matches, () => false);
}

/** Only a well-formed "#rrggbb" may reach a style; anything else keeps the theme's primary colour. */
function brandStyle(color: string): CSSProperties | undefined {
  return /^#[0-9a-f]{6}$/i.test(color) ? ({ "--tm-brand": color } as CSSProperties) : undefined;
}

/**
 * The kit app shell. Desktop: the sidebar beside a column of top bar, demo banner, page and status bar. Phones:
 * the same column with the bottom tab bar under it. The frame is pinned to the window and clipped, and only the
 * page scrolls, so focus moves and scroll-into-view inside the page never move the bars.
 */
export function AppShell() {
  const me = useCurrentUser();
  const sidebarId = useId();
  const phone = useIsPhone();

  if (!me) return null;

  return (
    <div className="shell" style={brandStyle(me.agency.brand_color)}>
      <div className="tm-ambient" aria-hidden="true" />
      <a
        href="#main"
        className="sr-only z-[60] rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-ink focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <Sidebar id={sidebarId} />
      <div className="main">
        <TopBar me={me} phone={phone} />
        {me.agency.is_demo && <DemoBanner />}
        <main id="main" tabIndex={-1} className="main-scroll">
          <div className="content">
            <Outlet />
          </div>
        </main>
        <StatusBar me={me} />
        {phone && <BottomTabs me={me} />}
      </div>
    </div>
  );
}
