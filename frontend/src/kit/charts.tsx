/**
 * UI kit charts (D:/Hackathons/ui-kit, src/ui/charts.jsx) ported to TypeScript: Gauge, LineChart, Spark, MiniRing,
 * StackedBars and Heatmap. Pure SVG on theme tokens. Entrances are CSS (the project's tm-draw / transitions) and are
 * skipped under reduced motion.
 */
import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { useReducedMotion } from "../ui/useReducedMotion";

/** True one frame after mount (always true under reduced motion), so a CSS transition can run from zero. */
function useEntered(): boolean {
  const reduced = useReducedMotion();
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return reduced || entered;
}

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

// ---------- readiness gauge (HUD ring) ----------
export function Gauge({
  score = 0,
  label,
  sub,
  color = "var(--tm-info)",
  size = 230,
  tour,
}: {
  /** 0-100. */
  score?: number;
  label: string;
  sub?: string;
  color?: string;
  size?: number;
  tour?: string;
}) {
  const id = useId().replace(/:/g, "");
  const entered = useEntered();
  const r = 86;
  const c = 2 * Math.PI * r;
  const arc = 0.78;
  const value = Math.max(0, Math.min(100, score));
  const ticks = Array.from({ length: 64 }, (_, i) => i);
  return (
    <div
      className="gauge"
      data-tour={tour}
      role="img"
      aria-label={`${label}: ${Math.round(value)} of 100${sub ? `, ${sub}` : ""}`}
      style={{ width: size, height: size, position: "relative", margin: "0 auto" }}
    >
      <svg viewBox="0 0 220 220" width={size} height={size} aria-hidden="true">
        <defs>
          <linearGradient id={`g${id}`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" style={{ stopColor: "var(--tm-grad-1)" }} />
            <stop offset="0.55" style={{ stopColor: "var(--tm-grad-2)" }} />
            <stop offset="1" style={{ stopColor: color }} />
          </linearGradient>
        </defs>
        {ticks.map((i) => {
          const a = (-90 - 140 + (i / 63) * 280) * (Math.PI / 180);
          const long = i % 8 === 0;
          const r1 = 104;
          const r2 = long ? 96 : 99;
          const on = i / 63 <= value / 100;
          return (
            <line
              key={i}
              x1={110 + r1 * Math.cos(a)}
              y1={110 + r1 * Math.sin(a)}
              x2={110 + r2 * Math.cos(a)}
              y2={110 + r2 * Math.sin(a)}
              stroke={on ? color : "var(--tm-border-soft)"}
              strokeWidth={long ? 2 : 1.2}
              strokeLinecap="round"
              opacity={on ? 0.9 : 1}
            />
          );
        })}
        <circle cx="110" cy="110" r={r} fill="none" stroke="var(--tm-card-2)" strokeWidth="12" strokeDasharray={`${c * arc} ${c}`} strokeLinecap="round" transform="rotate(130 110 110)" />
        <circle
          cx="110"
          cy="110"
          r={r}
          fill="none"
          stroke={`url(#g${id})`}
          strokeWidth="12"
          strokeLinecap="round"
          transform="rotate(130 110 110)"
          strokeDasharray={`${entered ? (c * arc * value) / 100 : 0} ${c}`}
          style={{ transition: `stroke-dasharray 1.2s ${EASE}`, filter: "drop-shadow(0 0 6px var(--tm-glow))" }}
        />
        <circle cx="110" cy="110" r="66" fill="var(--tm-bg)" fillOpacity={0.6} stroke="var(--tm-border)" />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
        <div>
          <div className="num" style={{ fontSize: size * 0.22, fontWeight: 600, lineHeight: 1 }}>
            {Math.round(value)}
          </div>
          <div style={{ color, fontWeight: 700, fontFamily: "var(--font-display)", fontSize: size * 0.075, marginTop: 4 }}>{label}</div>
          {sub && (
            <div className="hud" style={{ marginTop: 4, fontSize: 9.5 }}>
              {sub}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- line / area chart with optional band and hover ----------
export type KitLine = { key: string; label: string; color: string; fill?: boolean; dashed?: boolean; glow?: boolean; width?: number };
type Row = Record<string, string | number | null | undefined>;

export function LineChart({
  data,
  lines,
  height = 190,
  yMin,
  yMax,
  band,
  xKey = "date",
  fmtX = (v) => String(v).slice(5),
  fmtY = (v) => String(Math.round(v)),
  label,
  tour,
}: {
  data: Row[];
  lines: KitLine[];
  height?: number;
  yMin?: number;
  yMax?: number;
  band?: { from: number; to: number; color?: string; label?: string };
  xKey?: string;
  fmtX?: (value: string | number) => string;
  fmtY?: (value: number) => string;
  /** Accessible name of the chart. */
  label: string;
  tour?: string;
}) {
  const W = 640;
  const H = height;
  const P = { l: 8, r: 8, t: 12, b: 4 };
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const reduced = useReducedMotion();
  const id = useId().replace(/:/g, "");
  const num = (v: Row[string]): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const vals = data.flatMap((d) => lines.map((l) => num(d[l.key]))).filter((v): v is number => v !== null);
  const lo = yMin ?? Math.min(0, ...vals);
  const hi = yMax ?? Math.max(1, ...vals) * 1.12;
  const x = (i: number) => P.l + (i / Math.max(1, data.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - lo) / (hi - lo || 1)) * (H - P.t - P.b);
  const paths = lines.map((l) => {
    let d = "";
    let started = false;
    data.forEach((p, i) => {
      const v = num(p[l.key]);
      if (v === null) {
        started = false;
        return;
      }
      d += `${started ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      started = true;
    });
    const area = l.fill && d ? `${d}L${x(data.length - 1)},${H}L${x(0)},${H}Z` : null;
    return { ...l, d, area };
  });
  const onMove = (event: MouseEvent<SVGSVGElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || data.length === 0) return;
    const i = Math.round(((event.clientX - rect.left) / rect.width) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };
  const hovered = hover === null ? undefined : data[hover];
  const step = Math.max(1, Math.ceil(data.length / 6));
  return (
    <div data-tour={tour} style={{ position: "relative" }}>
      <svg
        ref={ref}
        role="img"
        aria-label={label}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          {lines.map((l) => (
            <linearGradient key={l.key} id={`a${id}${l.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={l.color} stopOpacity="0.35" />
              <stop offset="1" stopColor={l.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={W} y1={P.t + f * (H - P.t - P.b)} y2={P.t + f * (H - P.t - P.b)} stroke="var(--tm-chart-grid)" vectorEffect="non-scaling-stroke" />
        ))}
        {band && <rect x="0" width={W} y={y(band.to)} height={Math.max(0, y(band.from) - y(band.to))} fill={band.color ?? "var(--tm-selected)"} />}
        {paths.map((p) => p.area && <path key={`a${p.key}`} d={p.area} fill={`url(#a${id}${p.key})`} />)}
        {paths.map((p) => (
          <path
            key={p.key}
            d={p.d}
            fill="none"
            stroke={p.color}
            strokeWidth={p.width ?? 2.2}
            strokeDasharray={p.dashed ? "5 5" : undefined}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            pathLength={reduced || p.dashed ? undefined : 1}
            className={reduced || p.dashed ? undefined : "tm-draw"}
            style={{ filter: p.glow ? `drop-shadow(0 0 6px ${p.color})` : undefined }}
          />
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} stroke="var(--tm-border-soft)" vectorEffect="non-scaling-stroke" strokeDasharray="3 3" />}
      </svg>
      {band?.label && (
        <div className="pill-src" style={{ position: "absolute", right: 6, top: (y(band.to) / H) * height - 2 }}>
          {band.label}
        </div>
      )}
      <div className="row between" style={{ marginTop: 6 }}>
        {data
          .map((d, i) => ({ d, i }))
          .filter(({ i }) => i % step === 0 || i === data.length - 1)
          .map(({ d, i }) => (
            <span key={i} className="pill-src">
              {fmtX(d[xKey] ?? "")}
            </span>
          ))}
      </div>
      {hover !== null && hovered && (
        <div
          className="card tight"
          style={{
            position: "absolute",
            top: 6,
            left: `${Math.min(72, (hover / Math.max(1, data.length - 1)) * 100)}%`,
            pointerEvents: "none",
            fontSize: 12,
            zIndex: 2,
            background: "var(--tm-surface)",
          }}
        >
          <div className="hud">{fmtX(hovered[xKey] ?? "")}</div>
          {lines.map((l) => {
            const v = num(hovered[l.key]);
            return (
              <div key={l.key} className="row" style={{ gap: 6 }}>
                <i style={{ width: 8, height: 8, borderRadius: 2, background: l.color }} />
                {l.label}: <b>{v === null ? "–" : fmtY(v)}</b>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- stacked bars with a reference line ----------
/** The kit's six series colours, as chart tokens. */
export const SERIES_COLORS = ["var(--tm-chart-1)", "var(--tm-chart-2)", "var(--tm-chart-3)", "var(--tm-chart-4)", "var(--tm-chart-5)", "var(--tm-chart-6)"];

export type StackedDay = { date: string; label: string; total: number; bySeries: Record<string, number> };

export function StackedBars({
  days,
  limit,
  height = 170,
  colors,
  limitLabel,
  label,
  tour,
}: {
  days: StackedDay[];
  /** Draws a dashed reference line at this value. */
  limit?: number;
  height?: number;
  /** Colour per series name (theme tokens); defaults to SERIES_COLORS in order of first appearance. */
  colors?: Record<string, string>;
  limitLabel?: string;
  label: string;
  tour?: string;
}) {
  const entered = useEntered();
  const series = [...new Set(days.flatMap((d) => Object.keys(d.bySeries)))];
  const colorOf = (name: string) => colors?.[name] ?? SERIES_COLORS[series.indexOf(name) % SERIES_COLORS.length] ?? "var(--tm-chart-1)";
  const max = Math.max((limit ?? 0) * 1.25, ...days.map((d) => d.total || 0), 1);
  return (
    <div data-tour={tour} role="img" aria-label={label}>
      <div style={{ position: "relative", height, display: "grid", gridTemplateColumns: `repeat(${days.length}, minmax(0,1fr))`, gap: 6, alignItems: "end" }}>
        {limit !== undefined && (
          <div style={{ position: "absolute", left: 0, right: 0, bottom: `${(limit / max) * 100}%`, borderTop: "1.5px dashed var(--tm-danger)", opacity: 0.7 }}>
            <span className="pill-src" style={{ position: "absolute", right: 0, top: -16, color: "var(--tm-danger)" }}>
              {limitLabel ?? `limit ${limit}`}
            </span>
          </div>
        )}
        {days.map((d, i) => (
          <div key={d.date} style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 2 }} title={`${d.date}: ${d.total}`}>
            {Object.entries(d.bySeries)
              .filter(([, v]) => v > 0)
              .map(([name, v]) => (
                <div
                  key={name}
                  style={{
                    height: entered ? `${(v / max) * 100}%` : 0,
                    transition: `height 0.7s ${EASE} ${i * 0.04}s`,
                    background: colorOf(name),
                    borderRadius: 5,
                    minHeight: 3,
                  }}
                />
              ))}
            {!d.total && <div style={{ height: 3, borderRadius: 3, background: "var(--tm-card-2)" }} />}
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${days.length}, minmax(0,1fr))`, gap: 6, marginTop: 8 }}>
        {days.map((d) => (
          <span key={d.date} className="pill-src" style={{ textAlign: "center" }}>
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------- spark ----------
export function Spark({ values, color = "var(--tm-info)", height = 34, width = 110 }: { values: Array<number | null>; color?: string; height?: number; width?: number }) {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (nums.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  let d = "";
  let started = false;
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      started = false;
      return;
    }
    const px = (i / (values.length - 1)) * width;
    const py = height - 3 - ((v - lo) / (hi - lo || 1)) * (height - 6);
    d += `${started ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`;
    started = true;
  });
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---------- heatmap (rows x days) ----------
export function Heatmap({
  rows,
  days,
  max = 12,
  onRow,
  label,
  tour,
}: {
  rows: Array<{ id: string; name: string; cells: Array<number | null> }>;
  /** ISO dates, one per column. */
  days: string[];
  max?: number;
  onRow?: (id: string) => void;
  label: string;
  tour?: string;
}) {
  return (
    <div data-tour={tour} style={{ overflowX: "auto" }} role="group" aria-label={label}>
      <div style={{ display: "grid", gridTemplateColumns: `92px repeat(${days.length}, minmax(18px, 1fr))`, gap: 4, minWidth: 92 + days.length * 22 }}>
        <span />
        {days.map((d) => (
          <span key={d} className="pill-src" style={{ textAlign: "center", fontSize: 9.5 }}>
            {d.slice(8)}
          </span>
        ))}
        {rows.map((r) => (
          <HeatRow key={r.id} row={r} max={max} onRow={onRow} />
        ))}
      </div>
    </div>
  );
}

/** How a cell is painted: hatched when private, faint at zero, then the AI tone, the accent and the alert tone by intensity. */
function cellStyle(v: number | null, max: number) {
  if (v === null) return { background: "repeating-linear-gradient(135deg, var(--tm-selected) 0 4px, transparent 4px 8px)" };
  if (v === 0) return { background: "var(--tm-card-2)" };
  const t = Math.min(1, v / max);
  const fill = t > 0.85 ? "var(--tm-danger)" : t > 0.55 ? "var(--tm-primary)" : "var(--tm-ai)";
  return { background: fill, opacity: 0.3 + t * 0.6 };
}

function HeatRow({ row, max, onRow }: { row: { id: string; name: string; cells: Array<number | null> }; max: number; onRow?: (id: string) => void }) {
  return (
    <>
      <button
        type="button"
        className="small"
        onClick={() => onRow?.(row.id)}
        style={{ textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--tm-text-2)" }}
      >
        {row.name}
      </button>
      {row.cells.map((v, i) => (
        <span key={i} title={v === null ? "private" : String(v)} style={{ height: 22, borderRadius: 5, ...cellStyle(v, max) }} />
      ))}
    </>
  );
}

// ---------- radial mini ring ----------
export function MiniRing({ value, max = 1, color = "var(--tm-primary)", size = 54, label }: { value: number; max?: number; color?: string; size?: number; label?: string }) {
  const entered = useEntered();
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg viewBox="0 0 54 54" width={size} height={size} aria-hidden="true">
        <circle cx="27" cy="27" r={r} fill="none" stroke="var(--tm-card-2)" strokeWidth="5" />
        <circle
          cx="27"
          cy="27"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          transform="rotate(-90 27 27)"
          strokeDasharray={`${entered ? c * Math.min(1, value / max) : 0} ${c}`}
          style={{ transition: "stroke-dasharray 1s ease" }}
        />
      </svg>
      <div className="center" style={{ position: "absolute", inset: 0, fontSize: 11.5, fontWeight: 700 }}>
        {label}
      </div>
    </div>
  );
}
