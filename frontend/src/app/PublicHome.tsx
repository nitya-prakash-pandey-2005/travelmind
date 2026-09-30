import { Link } from "@tanstack/react-router";

const linkBase =
  "inline-flex h-10 items-center justify-center rounded-sm px-4 font-display text-sm uppercase tracking-[0.14em] transition duration-200 ease-tm";

/**
 * The public front door for signed-out visitors (signed-in visitors are sent on to /app).
 * The full marketing landing page replaces this later; it keeps the same two ways in.
 */
export function PublicHome() {
  return (
    <main className="tm-grid tm-scanlines flex min-h-dvh flex-col items-center justify-center gap-8 p-6 text-center">
      <p className="font-display text-xl tracking-[0.4em] text-primary">TRAVELMIND</p>
      <div className="flex max-w-xl flex-col gap-3">
        <h1 className="font-display text-3xl leading-tight tracking-wide text-ink sm:text-4xl">
          The mission control for modern travel agencies
        </h1>
        <p className="text-dim">
          Search live airline and hotel inventory, see what every fare really means, and send polished quotes in
          minutes.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link to="/signup" className={`${linkBase} tm-glow bg-primary text-primary-ink hover:brightness-110`}>
          Start free
        </Link>
        <Link to="/login" className={`${linkBase} border border-line text-ink hover:border-primary/70 hover:text-primary`}>
          Sign in
        </Link>
      </div>
    </main>
  );
}
