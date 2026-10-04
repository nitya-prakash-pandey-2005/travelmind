import { useElementSize } from "../../lib/useElementSize";
import { areaPath, linearScale, pathFromPoints, type Point } from "./scale";
import { ChartDataTable, useChartAnimation, useChartColors, type ChartTone } from "./shared";

export type SparklineTone = ChartTone;

// Room for the last-point dot (r 2.5) and its 1.5px surface ring.
const PAD = 4;
const FALLBACK = 120;

/** Word-sized trend line with a dot on the latest value. Renders nothing without values. */
export function Sparkline({
  values,
  label,
  tone = "primary",
  height = 32,
}: {
  values: number[];
  label: string;
  tone?: SparklineTone;
  height?: number;
}) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const animate = useChartAnimation();
  const colors = useChartColors();
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return null;

  const width = size.width || FALLBACK;
  const color = colors.tone[tone];
  const x = linearScale([0, finite.length - 1], [PAD, width - PAD]);
  const y = linearScale([Math.min(...finite), Math.max(...finite)], [height - PAD, PAD]);
  const points: Point[] = finite.map((v, i) => [x(i), y(v)]);
  const first = finite[0] ?? 0;
  const last = finite.at(-1) ?? 0;

  return (
    <div className="min-w-0">
      <div ref={ref} role="img" aria-label={`${label}: from ${first} to ${last}`}>
        <svg aria-hidden="true" width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="block overflow-visible">
          <path d={areaPath(points, height)} fill={color} fillOpacity={0.1} />
          <path
            data-line=""
            d={pathFromPoints(points)}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            pathLength={animate ? 1 : undefined}
            data-animate={animate ? "" : undefined}
            className={animate ? "tm-draw" : undefined}
          />
          <circle data-last-dot="" cx={x(finite.length - 1)} cy={y(last)} r={2.5} fill={color} stroke={colors.surface} strokeWidth={1.5} />
        </svg>
      </div>
      <ChartDataTable
        caption={`${label} data`}
        headers={["Point", "Value"]}
        rows={finite.map((v, i) => [String(i + 1), String(v)])}
      />
    </div>
  );
}
