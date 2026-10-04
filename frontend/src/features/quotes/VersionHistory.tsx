import { FileClock } from "lucide-react";
import type { QuoteDetail, QuoteVersion } from "../../api/quotes";
import { formatRelativeTime } from "../../lib/format";
import { formatWholeMoney } from "../../lib/money";
import { Badge } from "../../ui/Badge";
import { cn } from "../../ui/cn";
import { EmptyState } from "../../ui/EmptyState";
import { Panel } from "../../ui/Panel";

const STAMP = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** "₹5,757 – ₹6,732", or one amount when every option costs the same. */
export function sellRange(version: QuoteVersion, currency: string): string {
  const { min_sell_minor: min, max_sell_minor: max } = version.totals;
  const low = formatWholeMoney(min, currency);
  const high = formatWholeMoney(max, currency);
  return low === high ? low : `${low} – ${high}`;
}

/** The cheapest option's change from the version before, in whole units. */
function Change({ version, previous, currency }: { version: QuoteVersion; previous: QuoteVersion | undefined; currency: string }) {
  if (!previous) return <span className="text-xs text-faint">First version</span>;
  const diff = version.totals.min_sell_minor - previous.totals.min_sell_minor;
  const amount = formatWholeMoney(Math.abs(diff), currency);
  if (diff === 0 || amount === formatWholeMoney(0, currency)) {
    return <span className="text-xs text-dim">No change</span>;
  }
  const up = diff > 0;
  return (
    <span title={`Cheapest option vs v${previous.version}`} className="text-xs">
      <span className={cn("font-mono tabular-nums", up ? "text-warn" : "text-ok")}>{`${up ? "▲" : "▼"} ${amount}`}</span>
      <span className="sr-only">{`${up ? "dearer" : "cheaper"} than version ${previous.version}`}</span>
    </span>
  );
}

/**
 * Every version, newest first: when and by whom it was saved, its options and sell range, how the
 * cheapest option moved from the version before, and which one the client's link shows. Selecting
 * one previews it.
 */
export function VersionHistory({
  quote,
  previewing,
  onPreview,
  names,
  now,
  className,
}: {
  quote: QuoteDetail;
  /** The version shown in the preview. */
  previewing: number | null;
  onPreview: (version: number) => void;
  /** User id → full name, for "saved by". */
  names: ReadonlyMap<string, string>;
  now: Date;
  className?: string;
}) {
  const { versions } = quote;
  return (
    <Panel
      title="Versions"
      description={versions.length > 0 ? `${versions.length} saved · newest first · select one to preview` : "Each save keeps a priced copy"}
      flush
      className={className}
    >
      {versions.length === 0 ? (
        <EmptyState
          icon={FileClock}
          title="No versions yet"
          description="Each version you save is kept here with its prices, so you can compare and re-send."
          className="pb-6 pt-2"
        />
      ) : (
        <ol className="flex flex-col border-t border-line">
          {versions.map((version, index) => {
            const selected = version.version === previewing;
            const sent = version.version === quote.sent_version;
            const author = version.created_by ? names.get(version.created_by) : undefined;
            return (
              <li key={version.version} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onPreview(version.version)}
                  className={cn(
                    "relative flex w-full flex-col gap-1 px-4 py-2.5 text-left transition-colors duration-150 ease-tm hover:bg-hover",
                    "focus-visible:-outline-offset-2",
                    selected && "bg-surface-2",
                  )}
                >
                  {selected && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
                  <span className="flex w-full flex-wrap items-center gap-2">
                    <span className="font-mono text-[13px] font-semibold text-ink">v{version.version}</span>
                    {index === 0 && <Badge tone="neutral">Latest</Badge>}
                    {sent && <Badge tone="primary">Client sees this version</Badge>}
                    <span className="ml-auto font-mono text-[13px] tabular-nums text-ink">{sellRange(version, quote.currency)}</span>
                  </span>
                  <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-dim">
                    <span>
                      {version.totals.options} option{version.totals.options === 1 ? "" : "s"}
                    </span>
                    <span aria-hidden="true" className="text-faint">
                      ·
                    </span>
                    <time dateTime={version.created_at} title={STAMP.format(new Date(version.created_at))}>
                      {formatRelativeTime(version.created_at, now)}
                    </time>
                    {author && (
                      <>
                        <span aria-hidden="true" className="text-faint">
                          ·
                        </span>
                        <span className="truncate">{author}</span>
                      </>
                    )}
                    <span className="ml-auto">
                      <Change version={version} previous={versions[index + 1]} currency={quote.currency} />
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
