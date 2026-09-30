import { Link } from "@tanstack/react-router";
import { Panel } from "../ui/Panel";

export function NotFound() {
  return (
    <div className="tm-grid flex min-h-dvh items-center justify-center p-6">
      <Panel className="w-full max-w-lg" eyebrow="404">
        <h1 className="font-display text-2xl text-ink">Signal lost</h1>
        <p className="mb-4 mt-1 text-sm text-dim">There's nothing at this address.</p>
        <Link to="/" className="text-primary hover:underline">
          Return to Command Center
        </Link>
      </Panel>
    </div>
  );
}
