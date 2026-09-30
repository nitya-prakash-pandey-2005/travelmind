import { Link } from "@tanstack/react-router";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { ThemeToggle } from "../../ui/ThemeToggle";
import { CtaLink } from "./CtaLink";
import { FeatureGrid } from "./FeatureGrid";
import { Hero } from "./Hero";
import { HowItWorks } from "./HowItWorks";
import { LandingFooter } from "./LandingFooter";
import { PlatformFacts } from "./PlatformFacts";

const START_FREE_CONTEXT = ": create an agency account";

function TopNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-void/75 backdrop-blur-md">
      <nav aria-label="Main" className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <Link to="/" className="mr-auto font-display text-sm tracking-[0.3em] text-primary sm:text-base sm:tracking-[0.4em]">
          TRAVELMIND
        </Link>
        <a href="#features" className="hidden text-sm text-dim transition-colors hover:text-ink md:inline">
          Features
        </a>
        <a href="#how-it-works" className="hidden text-sm text-dim transition-colors hover:text-ink md:inline">
          How it works
        </a>
        <Link to="/login" className="text-sm text-dim transition-colors hover:text-ink">
          Sign in
        </Link>
        <CtaLink to="/signup" size="sm" context={START_FREE_CONTEXT}>
          Start free
        </CtaLink>
        <span className="hidden sm:inline-flex">
          <ThemeToggle />
        </span>
      </nav>
    </header>
  );
}

function ClosingCall() {
  return (
    <section aria-labelledby="closing-title" className="px-4 py-20 sm:px-6 lg:py-28">
      <div className="tm-glass tm-edge relative isolate mx-auto max-w-5xl overflow-hidden rounded-lg px-6 py-14 text-center sm:px-12 sm:py-20">
        <div aria-hidden="true" className="tm-grid tm-grid-fade absolute inset-0 -z-10" />
        <div aria-hidden="true" className="tm-hero-glow absolute -top-1/2 left-1/2 -z-10 h-full w-3/4 -translate-x-1/2" />
        <h2 id="closing-title" className="mx-auto max-w-2xl font-display text-3xl font-semibold leading-tight tracking-wide text-balance text-ink sm:text-4xl">
          See your agency's day on one screen
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-dim">
          Open a demo workspace with sample clients and enquiries, priced by real sandbox searches and clearly labelled
          as demo data. Or start free with your own agency.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <CtaLink to="/demo" size="lg" context=": no sign-up needed">
            Explore live demo
          </CtaLink>
          <CtaLink to="/signup" size="lg" variant="ghost" context={START_FREE_CONTEXT}>
            Start free
          </CtaLink>
        </div>
      </div>
    </section>
  );
}

/** The public front door: the pitch, live platform facts and two ways in (demo or sign-up). */
export function LandingPage() {
  useDocumentTitle("TravelMind — Mission control for travel agencies");
  return (
    <div className="tm-landing tm-scanlines min-h-dvh overflow-x-clip">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-sm focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-ink"
      >
        Skip to content
      </a>
      <TopNav />
      <main id="main" tabIndex={-1} className="outline-none">
        <Hero />
        <PlatformFacts />
        <FeatureGrid />
        <HowItWorks />
        <ClosingCall />
      </main>
      <LandingFooter />
    </div>
  );
}
