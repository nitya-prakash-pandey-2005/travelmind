import { cn } from "./cn";

type AvatarSize = "sm" | "md" | "lg";

// Spelled out so the class scanner sees every colour; chart colours double as avatar hues.
const COLOURS: ReadonlyArray<{ id: string; className: string }> = [
  { id: "chart-1", className: "text-chart-1" },
  { id: "chart-2", className: "text-chart-2" },
  { id: "chart-3", className: "text-chart-3" },
  { id: "chart-4", className: "text-chart-4" },
  { id: "chart-5", className: "text-chart-5" },
  { id: "chart-6", className: "text-chart-6" },
];

const SIZES: Record<AvatarSize, string> = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-[11px]",
  lg: "h-10 w-10 text-sm",
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
        "tm-tint inline-grid shrink-0 select-none place-items-center rounded-full border font-mono font-medium leading-none",
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
        <li key={`${name}-${index}`} className="rounded-full bg-deck ring-2 ring-deck">
          <Avatar name={name} size={size} />
        </li>
      ))}
      {hidden.length > 0 && (
        <li
          title={hidden.join(", ")}
          className={cn(
            "inline-grid place-items-center rounded-full border border-line bg-raised font-mono font-medium text-dim ring-2 ring-deck",
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
