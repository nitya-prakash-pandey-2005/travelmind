import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { useId } from "react";
import { useThemePalette, type ThemeMode } from "../../theme";
import { cn } from "../../ui/cn";
import { FIELD_CONTROL, FIELD_LABEL } from "../../ui/TextField";
import { brandAccent } from "../publicQuote/brandAccent";
import { brandChecks, formatRatio, MIN_ACCENT_CONTRAST, MIN_TEXT_CONTRAST, themePalette, type BrandCheck } from "./brandContrast";

const MODE_NAME = { dark: "Dark theme", light: "Light theme" } as const;
const MODES: readonly ThemeMode[] = ["dark", "light"];
const VERDICT = { faint: "Too faint", text: "Text won't read" } as const;

type BrandColourFieldProps = {
  /** The agency name as typed, for the preview header. */
  agencyName: string;
  /** What the hex field holds (already normalised). */
  text: string;
  /** The colour to preview and check: the typed one when valid, else the saved one; null when neither is. */
  shown: string | null;
  /** The colour as saved on the server, when it is a valid brand colour. */
  saved: string | null;
  hexError: string | undefined;
  /** The typed colour differs from the saved one and fails a theme: saving is blocked. */
  blocked: boolean;
  disabled: boolean;
  onText: (value: string) => void;
  onBlur: () => void;
};

/**
 * The agency's brand colour: a native picker and a strict hex field kept in step, the contrast it reaches on
 * the dark and the light theme, and a preview of the client quote page in both.
 */
export function BrandColourField({ agencyName, text, shown, saved, hexError, blocked, disabled, onText, onBlur }: BrandColourFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const themePrimary = useThemePalette().primary.toLowerCase();
  const checks = shown ? brandChecks(shown) : [];
  const failing = checks.filter((check) => !check.passes);
  const savedFails = !blocked && shown !== null && shown === saved && failing.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex min-w-0 flex-col gap-1.5">
        <legend className={cn(FIELD_LABEL, "mb-1.5")}>Brand colour</legend>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label="Brand colour picker"
            value={shown ?? themePrimary}
            disabled={disabled}
            onChange={(event) => onText(event.target.value)}
            className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-line-strong bg-surface-2 p-1 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <div className="w-36">
            <input
              type="text"
              aria-label="Brand colour hex"
              value={text}
              disabled={disabled}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={hexError ? true : undefined}
              aria-describedby={hexError ? errorId : hintId}
              onChange={(event) => onText(event.target.value)}
              onBlur={onBlur}
              className={cn(FIELD_CONTROL, "font-mono", hexError ? "border-danger hover:border-danger" : "border-line-strong")}
            />
          </div>
        </div>
        {hexError ? (
          <p id={errorId} className="flex items-start gap-1.5 text-xs leading-4 text-danger">
            <CircleAlert size={13} aria-hidden="true" className="mt-px shrink-0" />
            <span>{hexError}</span>
          </p>
        ) : (
          <p id={hintId} className="text-xs leading-4 text-dim">
            Marks buttons, the header rule and the selected option on your client quote pages.
          </p>
        )}
      </fieldset>

      <div className="flex flex-col gap-2">
        <p className="tm-micro">
          Contrast check · default theme · {MIN_ACCENT_CONTRAST}:1 page and cards, {MIN_TEXT_CONTRAST}:1 text
        </p>
        {checks.length > 0 && (
          <ul aria-label="Contrast check" className="grid gap-2 sm:grid-cols-2">
            {checks.map((check) => (
              <CheckRow key={check.mode} check={check} />
            ))}
          </ul>
        )}
        {blocked && (
          <p role="alert" className="flex items-start gap-1.5 text-xs leading-4 text-danger">
            <CircleAlert size={13} aria-hidden="true" className="mt-px shrink-0" />
            <span>
              Clients would see the theme's accent instead. {failing.map(reason).join(" ")} {shadeAdvice(failing)}
            </span>
          </p>
        )}
        {savedFails && (
          <p className="flex items-start gap-1.5 text-xs leading-4 text-warn">
            <TriangleAlert size={13} aria-hidden="true" className="mt-px shrink-0" />
            <span>
              Your current colour isn't used on the {failing.map((c) => MODE_NAME[c.mode].toLowerCase()).join(" and ")}, so clients there see the
              theme's own accent instead. {failing.map(reason).join(" ")}
            </span>
          </p>
        )}
      </div>

      <QuotePreview colour={shown} name={agencyName} />
    </div>
  );
}

/** "Light theme: too close to the page or cards (1.0:1, needs 3:1)." */
function reason(check: BrandCheck): string {
  return check.problem === "faint"
    ? `${MODE_NAME[check.mode]}: too close to the page or cards (${formatRatio(check.ratio)}, needs ${MIN_ACCENT_CONTRAST}:1).`
    : `${MODE_NAME[check.mode]}: no text colour reads on it (${formatRatio(check.text)}, button labels need ${MIN_TEXT_CONTRAST}:1).`;
}

function shadeAdvice(failing: BrandCheck[]): string {
  const [only] = failing;
  if (failing.length !== 1 || !only) return "Pick a stronger colour.";
  if (only.problem === "text") return "Pick a lighter or darker shade.";
  return only.mode === "light" ? "Pick a darker shade." : "Pick a lighter shade.";
}

function CheckRow({ check }: { check: BrandCheck }) {
  const Icon = check.passes ? CircleCheck : CircleAlert;
  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-3 py-2">
      <span className="flex min-w-0 flex-col">
        <span className="text-[13px] font-medium text-ink">{MODE_NAME[check.mode]}</span>
        <span className="font-mono text-[11px] tabular-nums text-dim">
          {formatRatio(check.page)} page · {formatRatio(check.card)} cards · {formatRatio(check.text)} text
        </span>
      </span>
      <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs font-medium", check.passes ? "text-ok" : "text-danger")}>
        <Icon size={14} aria-hidden="true" />
        {check.problem ? VERDICT[check.problem] : "Passes"}
      </span>
    </li>
  );
}

/**
 * The top of a client quote page in one theme, drawn from that theme's own colours (not the app's current
 * look), with the accent the client page would really use there (`brandAccent`: the brand colour, or the
 * theme's own accent in its place). A picture of the layout: no quote data.
 */
function PreviewTile({ mode, colour, name }: { mode: ThemeMode; colour: string | null; name: string }) {
  const palette = themePalette(mode);
  const { accent, accentInk: ink, fromBrand } = brandAccent(colour ?? "", palette);
  const initial = name.trim().charAt(0).toUpperCase() || "A";
  return (
    <div className="flex flex-col gap-1">
      <div className="overflow-hidden rounded-md border" style={{ background: palette.bg, borderColor: palette.line }}>
        <div className="h-[3px]" style={{ background: accent }} />
        <div className="flex flex-col gap-3 p-3">
          <div className="flex items-center gap-2">
            <span
              className="grid h-6 w-6 shrink-0 place-items-center rounded-[5px] text-[11px] font-semibold"
              style={{ background: accent, color: ink }}
            >
              {initial}
            </span>
            <span className="truncate text-[13px] font-semibold" style={{ color: palette.ink }}>
              {name}
            </span>
          </div>
          <div className="flex flex-col gap-2 rounded-md border p-2.5" style={{ background: palette.surface, borderColor: palette.line }}>
            <span className="h-2 w-2/3 rounded-sm" style={{ background: palette.line }} />
            <span className="h-2 w-1/3 rounded-sm" style={{ background: palette.line }} />
            <span
              className="mt-1 inline-flex h-7 items-center justify-center self-start rounded-md px-3 text-xs font-medium"
              style={{ background: accent, color: ink }}
            >
              Accept option 1
            </span>
          </div>
        </div>
      </div>
      <span className="text-[11px] text-dim">
        {MODE_NAME[mode]}
        {colour && !fromBrand && (
          <>
            {" · "}
            <span className="text-warn">Theme accent shown instead</span>
          </>
        )}
      </span>
    </div>
  );
}

function QuotePreview({ colour, name }: { colour: string | null; name: string }) {
  return (
    <div role="group" aria-label="Client quote preview" className="flex flex-col gap-2">
      <p className="tm-micro">Client quote preview</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {MODES.map((mode) => (
          <PreviewTile key={mode} mode={mode} colour={colour} name={name} />
        ))}
      </div>
    </div>
  );
}
