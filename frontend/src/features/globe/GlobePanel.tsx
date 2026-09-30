import { Component, Suspense, lazy, useState, type ReactNode } from "react";
import { Panel, type PanelVariant } from "../../ui/Panel";
import { cn } from "../../ui/cn";
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

/** A GPU/WebGL failure must never take down the rest of the Command Center. */
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

type GlobePanelProps = {
  arcs: GlobeArc[];
  title?: string;
  eyebrow?: string;
  variant?: PanelVariant;
  actions?: ReactNode;
  className?: string;
  /** Shown under the globe (legend, route list, empty state). */
  children?: ReactNode;
};

export function GlobePanel({
  arcs,
  title = "Route globe",
  eyebrow = "Orbital view",
  variant,
  actions,
  className,
  children,
}: GlobePanelProps) {
  const [webgl] = useState(hasWebGL);
  return (
    <Panel
      eyebrow={eyebrow}
      title={title}
      variant={variant}
      actions={actions}
      className={cn("flex min-h-[420px] flex-1 flex-col", className)}
    >
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
      {children}
    </Panel>
  );
}
