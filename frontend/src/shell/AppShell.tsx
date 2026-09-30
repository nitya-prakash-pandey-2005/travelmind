import { Outlet } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useCurrentUser } from "../auth/useCurrentUser";
import { DemoBanner } from "./DemoBanner";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";

const DESKTOP = "(min-width: 64rem)";

function subscribeDesktop(callback: () => void): () => void {
  const media = window.matchMedia(DESKTOP);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

/** True from 1024 px, where the sidebar sits beside the page instead of opening as a drawer. */
function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP).matches, () => true);
}

/** Only a well-formed "#rrggbb" may reach a style; anything else keeps the theme's primary colour. */
function brandStyle(color: string): CSSProperties | undefined {
  return /^#[0-9a-f]{6}$/i.test(color) ? ({ "--tm-brand": color } as CSSProperties) : undefined;
}

export function AppShell() {
  const me = useCurrentUser();
  const sidebarId = useId();
  const isDesktop = useIsDesktop();
  const [navOpen, setNavOpen] = useState(false);
  const navButtonRef = useRef<HTMLButtonElement>(null);
  // The drawer only exists on small screens: widening the window closes it (and un-inerts the page).
  const drawerOpen = navOpen && !isDesktop;

  useEffect(() => {
    if (isDesktop) setNavOpen(false);
  }, [isDesktop]);

  if (!me) return null;

  const closeNav = (restoreFocus: boolean) => {
    setNavOpen(false);
    if (restoreFocus) navButtonRef.current?.focus();
  };

  return (
    <div className="tm-grid tm-scanlines flex h-dvh flex-col" style={brandStyle(me.agency.brand_color)}>
      <a
        href="#main"
        className="sr-only z-[60] rounded-sm bg-primary px-3 py-2 text-sm text-primary-ink focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <div inert={drawerOpen} className="contents">
        <TopBar
          me={me}
          sidebarId={sidebarId}
          navOpen={drawerOpen}
          onOpenNav={() => setNavOpen(true)}
          navButtonRef={navButtonRef}
        />
      </div>
      <div className="flex min-h-0 flex-1">
        <Sidebar id={sidebarId} mobileOpen={drawerOpen} onCloseMobile={closeNav} />
        <div inert={drawerOpen} className="flex min-w-0 flex-1 flex-col">
          {me.agency.is_demo && <DemoBanner />}
          <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-auto p-4 focus:outline-none lg:p-6">
            <Outlet />
          </main>
        </div>
      </div>
      <div inert={drawerOpen} className="contents">
        <StatusBar me={me} />
      </div>
    </div>
  );
}
