import { Component, Suspense, lazy, useState, type ReactNode } from "react";
import { Panel } from "../../ui/Panel";
import type { GlobeArc } from "./RouteGlobe";
import { hasWebGL } from "./webgl";

const RouteGlobe = lazy(() => import("./RouteGlobe"));

function Standby({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-[340px] items-center justify-center rounded-sm border border-dashed border-line">
      <p className="max-w-xs text-center font-mono text-xs uppercase tracking-[0.2em] text-dim">{message}</p>
    </div>
  );
}

/** A GPU/WebGL failure must never take down the rest of Mission Control. */
class GlobeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <Standby message="The orbital view went offline. Route data below still works." />
    ) : (
      this.props.children
    );
  }
}

export function GlobePanel({ arcs }: { arcs: GlobeArc[] }) {
  const [webgl] = useState(hasWebGL);
  return (
    <Panel eyebrow="Orbital view" title="Route globe" className="flex min-h-[420px] flex-1 flex-col">
      <div className="flex-1">
        {webgl ? (
          <GlobeBoundary>
            <Suspense fallback={<Standby message="Initialising orbital view…" />}>
              <RouteGlobe arcs={arcs} />
            </Suspense>
          </GlobeBoundary>
        ) : (
          <Standby message="3D globe isn't available on this device. Route data below still works." />
        )}
      </div>
    </Panel>
  );
}
