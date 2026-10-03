/** WCAG 2.x contrast maths for `#RRGGBB` colours (used by the palette checks and the design gallery). */

function channels(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((at) => Number.parseInt(value.slice(at, at + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two colours, 1 (none) to 21 (black on white). Order doesn't matter. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The opaque colour seen when `colour` at `alpha` (0-1) is painted over `background`. */
export function compositeOver(colour: string, background: string, alpha: number): string {
  const fg = channels(colour);
  const bg = channels(background);
  const mixed = fg.map((channel, i) => Math.round(channel * alpha + (bg[i] ?? 0) * (1 - alpha)));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0").toUpperCase()).join("")}`;
}
