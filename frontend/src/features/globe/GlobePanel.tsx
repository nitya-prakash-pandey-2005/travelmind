import type { LucideIcon } from "lucide-react";
import { Component, Suspense, lazy, useState, type ReactNode } from "react";
import { Panel, type PanelVariant } from "../../ui/Panel";
import { cn } from "../../ui/cn";
import type { GlobeArc } from "./RouteGlobe";
import { hasWebGL } from "./webgl";

const RouteGlobe = lazy(() => import("./RouteGlobe"));
const FlatRouteMap = lazy(() => import("./FlatRouteMap"));

/** Holds the map's space while a chunk loads, so nothing shifts when it lands. */
function MapPlaceholder({ message }: { message: string }) {
  return (
    <div className="grid h-full min-h-[300px] place-items-center rounded-[14px] border border-dashed border-line">
      <p className="text-xs text-faint">{message}</p>
    </div>
  );
}

/** The flat map, with a one-line note saying why it replaced the globe. */
function FlatFallback({ arcs, note }: { arcs: GlobeArc[]; note: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Suspense fallback={<MapPlaceholder message="Loading map…" />}>
        <FlatRouteMap arcs={arcs} />
      </Suspense>
      <p className="text-xs text-faint">{note}</p>
    </div>
  );
}

/** A GPU/WebGL failure must never take down the rest of the Command Center: fall back to the flat map. */
class GlobeBoundary extends Component<{ arcs: GlobeArc[]; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <FlatFallback arcs={this.props.arcs} note="The 3D globe stopped working, so this is a flat map of the same routes." />
    ) : (
      this.props.children
    );
  }
}

type GlobePanelProps = {
  arcs: GlobeArc[];
  title?: string;
  /** One line under the title. */
  description?: ReactNode;
  /** The kit's icon chip in the card head. */
  icon?: LucideIcon;
  variant?: PanelVariant;
  actions?: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** Shown under the map (route list, empty state). */
  children?: ReactNode;
  /** A shorter globe for a side column. */
  compact?: boolean;
};

/** Route map card: the 3D globe where WebGL works, otherwise a flat map of the same arcs. */
export function GlobePanel({
  arcs,
  title = "Route map",
  description,
  icon,
  variant,
  actions,
  footer,
  className,
  children,
  compact = false,
}: GlobePanelProps) {
  const [webgl] = useState(hasWebGL);
  return (
    <Panel
      title={title}
      description={description}
      icon={icon}
      variant={variant}
      actions={actions}
      footer={footer}
      className={cn("flex flex-col", className)}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {webgl ? (
          <GlobeBoundary arcs={arcs}>
            <Suspense fallback={<MapPlaceholder message="Loading globe…" />}>
              <RouteGlobe arcs={arcs} compact={compact} />
            </Suspense>
          </GlobeBoundary>
        ) : (
          <FlatFallback arcs={arcs} note="3D globe isn't available on this device, so this is a flat map." />
        )}
      </div>
      {children}
    </Panel>
  );
}
