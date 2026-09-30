import { BedDouble, Coins, History, Leaf, MapPin, Plane, type LucideIcon } from "lucide-react";
import { cn } from "../../ui/cn";
import { CONTAINER } from "./layout";

type DataSource = { name: string; role: string; icon: LucideIcon };

/**
 * The services the platform really calls (backend: offers/suppliers/duffel, hotels/liteapi,
 * offers/carbon, fareintel/travelpayouts, offers/fx, reference). Names only: no logos or marks.
 */
export const DATA_SOURCES: DataSource[] = [
  { name: "Duffel", role: "Flight offers", icon: Plane },
  { name: "LiteAPI", role: "Hotel rates", icon: BedDouble },
  { name: "Travel Impact Model", role: "CO₂ estimates by Google", icon: Leaf },
  { name: "Travelpayouts", role: "Fare history", icon: History },
  { name: "ECB reference rates", role: "Currency conversion", icon: Coins },
  { name: "OurAirports", role: "8,800+ airports", icon: MapPin },
];

/** A source as a plain text wordmark with a category glyph. */
export function SourceMark({ source, size = "md" }: { source: DataSource; size?: "sm" | "md" }) {
  const Icon = source.icon;
  return (
    <span className="flex min-w-0 items-start gap-2.5">
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md border border-line-strong bg-surface-2 text-dim",
          size === "md" ? "h-8 w-8" : "h-6 w-6",
        )}
      >
        <Icon size={size === "md" ? 15 : 12} strokeWidth={1.75} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className={cn("font-semibold tracking-[-0.01em] text-ink", size === "md" ? "text-sm leading-5" : "text-xs leading-4")}>
          {source.name}
        </span>
        <span className={cn("text-faint", size === "md" ? "text-xs leading-4" : "text-[11px] leading-4")}>{source.role}</span>
      </span>
    </span>
  );
}

/** Directly under the hero: what the product is plugged into, stated plainly. */
export function IntegrationsStrip() {
  return (
    <section id="data-sources" aria-labelledby="integrations-title" className="scroll-mt-16 border-b border-line">
      <div className={cn(CONTAINER, "flex flex-col gap-5 py-8 lg:flex-row lg:items-center lg:gap-12")}>
        <div className="shrink-0 lg:w-56">
          <h2 id="integrations-title" className="text-[15px] font-semibold text-ink">
            Connects to
          </h2>
          <p className="mt-1 text-[13px] leading-5 text-dim">The suppliers and public data sources behind every search.</p>
        </div>
        <ul className="grid flex-1 grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:border-l lg:border-line lg:pl-12">
          {DATA_SOURCES.map((source) => (
            <li key={source.name} className="min-w-0">
              <SourceMark source={source} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
