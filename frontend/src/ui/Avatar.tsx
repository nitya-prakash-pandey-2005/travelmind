import { cn } from "./cn";

type AvatarSize = "sm" | "md" | "lg";

// The kit's hue avatar: a two-stop gradient from one chart colour into the next (the kit picks an HSL hue; here
// the hues are theme tokens, so avatars follow the theme). Spelled out so the class scanner sees every pair.
const COLOURS: ReadonlyArray<{ id: string; className: string }> = [
  { id: "chart-1", className: "from-chart-1 to-chart-2" },
  { id: "chart-2", className: "from-chart-2 to-chart-3" },
  { id: "chart-3", className: "from-chart-3 to-chart-4" },
  { id: "chart-4", className: "from-chart-4 to-chart-5" },
  { id: "chart-5", className: "from-chart-5 to-chart-6" },
  { id: "chart-6", className: "from-chart-6 to-chart-1" },
];

const SIZES: Record<AvatarSize, string> = {
  sm: "h-6 w-6 rounded-[7px] text-[10px]",
  md: "h-8 w-8 rounded-[10px] text-[11.5px]",
  lg: "h-10 w-10 rounded-[12px] text-sm",
};

/** First letter of the first and last words: "Arjun Kumar Rao" → "AR". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words.at(0)?.charAt(0) ?? "";
  const last = words.length > 1 ? (words.at(-1)?.charAt(0) ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

/** Stable, well-spread string hash (FNV-1a) so a person keeps their colour everywhere. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function colourFor(name: string): { id: string; className: string } {
  return COLOURS[hash(name.trim().toLowerCase()) % COLOURS.length] ?? { id: "chart-1", className: "text-chart-1" };
}

export function Avatar({ name, size = "md", className }: { name: string; size?: AvatarSize; className?: string }) {
  const label = name.trim();
  const colour = colourFor(label);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-colour={colour.id}
      className={cn(
        "inline-grid shrink-0 select-none place-items-center bg-linear-135 font-display font-bold leading-none text-primary-ink",
        SIZES[size],
        colour.className,
        className,
      )}
    >
      <span aria-hidden="true">{initials(label)}</span>
    </span>
  );
}

/** Overlapping avatars; names beyond `max` collapse into a "+N" chip (listed for screen readers). */
export function AvatarStack({
  names,
  max = 3,
  size = "sm",
  className,
}: {
  names: string[];
  max?: number;
  size?: AvatarSize;
  className?: string;
}) {
  const shown = names.slice(0, max);
  const hidden = names.slice(max);
  return (
    <ul className={cn("flex items-center -space-x-1.5", className)}>
      {shown.map((name, index) => (
        <li key={`${name}-${index}`} className="rounded-[10px] ring-2 ring-bg">
          <Avatar name={name} size={size} />
        </li>
      ))}
      {hidden.length > 0 && (
        <li
          title={hidden.join(", ")}
          className={cn(
            "inline-grid place-items-center border border-line bg-surface-2 font-medium tabular-nums text-dim ring-2 ring-bg",
            SIZES[size],
          )}
        >
          <span aria-hidden="true">+{hidden.length}</span>
          <span className="sr-only">and {hidden.join(", ")}</span>
        </li>
      )}
    </ul>
  );
}
