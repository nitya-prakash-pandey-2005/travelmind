import { ChartDataTable, ChartEmpty, GRID, chartColor, formatValue, isValue, percent, useChartAnimation } from "./shared";

export type BarItem = { label: string; value: number; hint?: string };

const BAR = 8;
const RADIUS = 4;
const SUMMARY_ITEMS = 5;

/**
 * Ranked horizontal bars: label (and hint) left, value right in mono. Bars scale to `max`
 * (default: the largest value) with a rounded data end and a square baseline.
 */
export function BarList({
  items,
  valueFormat,
  label,
  max,
}: {
  items: BarItem[];
  valueFormat: (value: number) => string;
  label: string;
  max?: number;
}) {
  const animate = useChartAnimation();
  if (items.length === 0) return <ChartEmpty label={label} height={96} />;

  const top = max ?? Math.max(0, ...items.map((item) => item.value).filter(isValue));
  const listed = items.slice(0, SUMMARY_ITEMS).map((item) => `${item.label} ${formatValue(item.value, valueFormat)}`);
  const more = items.length > SUMMARY_ITEMS ? `, and ${items.length - SUMMARY_ITEMS} more` : "";

  return (
    <div className="min-w-0">
      <div role="img" aria-label={`${label}: ${listed.join(", ")}${more}`} className="flex flex-col gap-2.5">
        {items.map((item, i) => {
          const width = percent(item.value, top);
          return (
            <div key={`${item.label}-${i}`} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-3">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm text-ink">{item.label}</span>
                {item.hint && <span className="truncate text-[11px] text-dim">{item.hint}</span>}
              </div>
              <svg aria-hidden="true" width="100%" height={BAR} className="block overflow-visible">
                <rect width="100%" height={BAR} rx={RADIUS} fill={GRID} />
                {width !== "0%" && (
                  <g
                    data-animate={animate ? "" : undefined}
                    className={animate ? "tm-grow-x" : undefined}
                    style={animate ? { animationDelay: `${i * 50}ms` } : undefined}
                  >
                    {/* The bar's own viewport clips a longer rounded rect that starts off to the left:
                        the baseline end is square, the data end rounded, and nothing draws past the value. */}
                    <svg data-bar="" width={width} height={BAR} overflow="hidden">
                      <rect x="-50%" width="150%" height={BAR} rx={RADIUS} fill={chartColor(1)} />
                    </svg>
                  </g>
                )}
              </svg>
              <span data-value="" className="text-right font-mono text-sm tabular-nums text-ink">
                {formatValue(item.value, valueFormat)}
              </span>
            </div>
          );
        })}
      </div>
      <ChartDataTable
        caption={`${label} data`}
        headers={["Item", "Value"]}
        rows={items.map((item) => [item.hint ? `${item.label} (${item.hint})` : item.label, formatValue(item.value, valueFormat)])}
      />
    </div>
  );
}
