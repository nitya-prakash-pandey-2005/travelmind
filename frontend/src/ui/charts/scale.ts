/** Chart geometry helpers: pure functions, no DOM. Every output is finite for any finite input. */

export type Point = [number, number];

/** Maps `domain` onto `range` linearly. A flat domain maps every value to the range midpoint. */
export function linearScale(domain: [number, number], range: [number, number]): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  if (span === 0 || !Number.isFinite(span)) {
    const mid = (r0 + r1) / 2;
    return () => mid;
  }
  return (value) => r0 + ((value - d0) / span) * (r1 - r0);
}

const MANTISSAS = [1, 2, 2.5, 5, 10];

function tidy(value: number): number {
  return Number(value.toPrecision(12));
}

/** The smallest of 1, 2, 2.5 or 5 × 10^k that is >= `max`. Empty, zero or negative data gets 1. */
export function niceMax(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 1;
  const exponent = Math.floor(Math.log10(max));
  for (const mantissa of MANTISSAS) {
    // Divide for negative exponents so 0.1-style steps stay exact.
    const candidate = tidy(exponent >= 0 ? mantissa * 10 ** exponent : mantissa / 10 ** -exponent);
    if (candidate >= max) return candidate;
  }
  return tidy(10 ** (exponent + 1));
}

// Intervals per mantissa so every tick lands on a clean number (0, 5, 10, … / 0, 50, 100, …).
const INTERVALS: Record<string, number> = { "1": 2, "2": 4, "2.5": 5, "5": 5, "10": 2 };

/** Evenly spaced ticks from 0 to a `niceMax` value, inclusive. */
export function niceTicks(max: number): number[] {
  const top = niceMax(max);
  const mantissa = tidy(top / 10 ** Math.floor(Math.log10(top)));
  const intervals = INTERVALS[String(mantissa)] ?? 4;
  return Array.from({ length: intervals + 1 }, (_, i) => tidy((top * i) / intervals));
}

function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** SVG path through `points`: "M x y L x y …" with coordinates rounded to 2 decimals. */
export function pathFromPoints(points: Point[]): string {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${num(x)} ${num(y)}`).join("");
}

/** Closed SVG area under `points`, dropped to `baselineY` at both ends. */
export function areaPath(points: Point[], baselineY: number): string {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return "";
  const base = num(baselineY);
  return `M${num(first[0])} ${base}${pathFromPoints(points).replace(/^M/, "L")}L${num(last[0])} ${base}Z`;
}

/** Up to `maxTicks` indices spread evenly over `count` positions, always including both ends. */
export function pickTickIndices(count: number, maxTicks: number): number[] {
  if (count <= 0) return [];
  if (count <= maxTicks) return Array.from({ length: count }, (_, i) => i);
  const slots = Math.max(1, maxTicks - 1);
  const indices = Array.from({ length: slots + 1 }, (_, i) => Math.round((i * (count - 1)) / slots));
  return [...new Set(indices)];
}
