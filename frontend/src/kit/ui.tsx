/**
 * UI kit components (D:/Hackathons/ui-kit, src/ui/index.jsx) ported to TypeScript. Same markup and class names as
 * the kit; colours come from theme tokens only, and motion is CSS (stopped by the global reduced-motion rule).
 */
import type { LucideIcon } from "lucide-react";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { Drawer } from "../ui/Drawer";
import { cn } from "../ui/cn";

/** The kit's status tones: green good, amber watch, rose alert, cyan info, violet private/AI, pink the accent. */
export type KitTone = "pink" | "rose" | "violet" | "cyan" | "green" | "amber" | "muted";

/** Each tone's theme token (the kit's colour names are not aliased, see styles/kit/tokens.css). */
export const TONE_VAR: Record<KitTone, string> = {
  pink: "var(--tm-primary)",
  rose: "var(--tm-danger)",
  violet: "var(--tm-ai)",
  cyan: "var(--tm-info)",
  green: "var(--tm-ok)",
  amber: "var(--tm-warn)",
  muted: "var(--tm-text-3)",
};

/** First letters of the first two words: "Asha Rao" -> "AR". */
export function initials(name = ""): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

type CardProps = Omit<ComponentProps<"section">, "title"> & {
  title?: ReactNode;
  icon?: LucideIcon;
  right?: ReactNode;
  /** Kit modifiers: tight, flush, pad-lg, glow, interactive, alert, warn, good, private. */
  variant?: string;
  tour?: string;
};

/** Glass card with an optional head: icon chip, title (h3) and right-hand content. */
export function Card({ title, icon: Icon, right, variant, tour, className, children, ...rest }: CardProps) {
  return (
    <section className={cn("card", variant, className)} data-tour={tour} {...rest}>
      {(title || right) && (
        <div className="card-head">
          {Icon && (
            <span className="ic" aria-hidden="true">
              <Icon size={17} />
            </span>
          )}
          {title && <h3>{title}</h3>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

/** Mono uppercase HUD label. */
export function Hud({ children, tone, className }: { children: ReactNode; tone?: Exclude<KitTone, "rose" | "muted">; className?: string }) {
  return <span className={cn("hud", tone && `c-${tone}`, className)}>{children}</span>;
}

/** Pill badge in a tone, with an optional glowing dot. */
export function Badge({ tone = "muted", dot, children, className }: { tone?: KitTone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cn("badge", `t-${tone}`, className)}>
      {dot && <span className="dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export type SegOption<T extends string> = T | { value: T; label: ReactNode };

/** Segmented switch for 2-5 choices (a tab list, as in the kit). */
export function Seg<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: ReadonlyArray<SegOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the tab list. */
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn("seg", className)} role="tablist" aria-label={label}>
      {options.map((option) => {
        const v = typeof option === "object" ? option.value : option;
        const l = typeof option === "object" ? option.label : option;
        return (
          <button key={v} type="button" role="tab" aria-selected={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>
            {l}
          </button>
        );
      })}
    </div>
  );
}

/** On/off switch. */
export function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange?: (on: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      className={cn("toggle", on && "on")}
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!on)}
    />
  );
}

/** Stable, well-spread string hash (FNV-1a) so a name keeps its colours everywhere. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The kit's hue avatar: initials on a two-stop gradient. The kit picks an HSL hue; here the hue is one of the six
 * chart tokens (by `hue` index, else from the name) blended into the next, so it follows the theme.
 */
export function avatarFill(name: string, hue?: number): { index: number; background: string } {
  const index = ((hue ?? hash(name.trim().toLowerCase())) % 6 + 6) % 6;
  const next = (index + 1) % 6;
  return { index: index + 1, background: `linear-gradient(135deg, var(--tm-chart-${index + 1}), var(--tm-chart-${next + 1}))` };
}

export function Avatar({
  name,
  hue,
  size,
  status,
  className,
}: {
  name: string;
  /** 0-5: which chart token starts the gradient (default: from the name). */
  hue?: number;
  size?: "xs" | "sm" | "lg";
  /** A status dot colour, as a theme token (e.g. "var(--tm-ok)"). */
  status?: string;
  className?: string;
}) {
  const fill = avatarFill(name, hue);
  return (
    <span className={cn("avatar", size, className)} style={{ background: fill.background }} aria-hidden="true">
      {initials(name)}
      {status && <span className="status" style={{ background: status }} />}
    </span>
  );
}

/** Big Space Grotesk number with a unit and a label under it. */
export function Stat({ value, unit, label, tone, className }: { value: ReactNode; unit?: ReactNode; label: ReactNode; tone?: KitTone; className?: string }) {
  return (
    <div className={cn("stat", className)}>
      <div className="v" style={tone ? { color: TONE_VAR[tone] } : undefined}>
        {value}
        {unit && <small>{unit}</small>}
      </div>
      <div className="l">{label}</div>
    </div>
  );
}

/** Progress bar on the accent gradient (0-100). */
export function Progress({ value, color, label }: { value: number; color?: string; label?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="progress" role={label ? "progressbar" : undefined} aria-label={label} aria-valuenow={label ? Math.round(clamped) : undefined}>
      <i style={{ width: `${clamped}%`, ...(color ? { background: color } : {}) } as CSSProperties} />
    </div>
  );
}

/** Page head: HUD kicker, h1 title, sub line and right-hand actions. */
export function PageHead({ kicker, title, sub, right, tour }: { kicker?: ReactNode; title: ReactNode; sub?: ReactNode; right?: ReactNode; tour?: string }) {
  return (
    <div className="page-head" data-tour={tour}>
      <div className="grow">
        {kicker && <Hud tone="pink">{kicker}</Hud>}
        <h1 style={{ marginTop: kicker ? 6 : 0 }}>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/**
 * The kit's Sheet: a right-hand panel on desktop and a bottom sheet on phones. Built on the shared modal surface
 * (native <dialog>), so it traps focus, closes on Escape and the scrim, and hands focus back to its opener.
 */
export function Sheet({ open, onClose, title, description, children, footer }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <Drawer open={open} onClose={onClose} title={title} description={description} footer={footer}>
      {children}
    </Drawer>
  );
}

export const pct = (p: number, digits = 1) => `${(p * 100).toFixed(digits)}%`;
