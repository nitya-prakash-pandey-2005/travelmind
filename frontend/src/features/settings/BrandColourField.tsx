import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { useId } from "react";
import type { Palette } from "../../theme";
import { cn } from "../../ui/cn";
import { FIELD_CONTROL, FIELD_LABEL } from "../../ui/TextField";
import { brandChecks, brandInk, formatRatio, MIN_ACCENT_CONTRAST, type BrandCheck } from "./brandContrast";

const MODE_NAME = { dark: "Dark theme", light: "Light theme" } as const;

type BrandColourFieldProps = {
  /** The agency name as typed, for the preview header. */
  agencyName: string;
  /** What the hex field holds (already normalised). */
  text: string;
  /** The colour to preview and check: the typed one when valid, else the saved one. */
  shown: string;
  /** The colour as saved on the server. */
  saved: string;
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
  const checks = brandChecks(shown);
  const failing = checks.filter((check) => !check.passes);
  const savedFails = !blocked && shown === saved && failing.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex min-w-0 flex-col gap-1.5">
        <legend className={cn(FIELD_LABEL, "mb-1.5")}>Brand colour</legend>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label="Brand colour picker"
            value={shown}
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
        <p className="tm-micro">Contrast check · default theme · at least {MIN_ACCENT_CONTRAST}:1</p>
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
              This colour needs at least {MIN_ACCENT_CONTRAST}:1 against both themes to work as an accent. {shadeAdvice(failing)}
            </span>
          </p>
        )}
        {savedFails && (
          <p className="flex items-start gap-1.5 text-xs leading-4 text-warn">
            <TriangleAlert size={13} aria-hidden="true" className="mt-px shrink-0" />
            <span>
              Your current colour is below {MIN_ACCENT_CONTRAST}:1 on the {failing.map((c) => MODE_NAME[c.mode].toLowerCase()).join(" and ")}, so
              clients there see the theme's own accent instead.
            </span>
          </p>
        )}
      </div>

      <QuotePreview checks={checks} colour={shown} name={agencyName} />
    </div>
  );
}

function shadeAdvice(failing: BrandCheck[]): string {
  if (failing.length !== 1) return "Pick a stronger colour.";
  return failing[0]?.mode === "light" ? "Pick a darker shade." : "Pick a lighter shade.";
}

function CheckRow({ check }: { check: BrandCheck }) {
  const Icon = check.passes ? CircleCheck : CircleAlert;
  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-3 py-2">
      <span className="flex min-w-0 flex-col">
        <span className="text-[13px] font-medium text-ink">{MODE_NAME[check.mode]}</span>
        <span className="font-mono text-[11px] tabular-nums text-dim">
          {formatRatio(check.page)} page · {formatRatio(check.card)} cards
        </span>
      </span>
      <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs font-medium", check.passes ? "text-ok" : "text-danger")}>
        <Icon size={14} aria-hidden="true" />
        {check.passes ? "Passes" : "Too faint"}
      </span>
    </li>
  );
}

/**
 * The top of a client quote page in one theme, drawn from that theme's own colours (not the app's current
 * look), with the brand colour as it would be used there. A picture of the layout: no quote data.
 */
function PreviewTile({ palette, colour, name, usesBrand }: { palette: Palette; colour: string; name: string; usesBrand: boolean }) {
  const accent = usesBrand ? colour : palette.primary;
  const ink = usesBrand ? brandInk(colour, palette) : palette.primaryInk;
  const initial = name.trim().charAt(0).toUpperCase() || "A";
  return (
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
  );
}

function QuotePreview({ checks, colour, name }: { checks: BrandCheck[]; colour: string; name: string }) {
  return (
    <div role="group" aria-label="Client quote preview" className="flex flex-col gap-2">
      <p className="tm-micro">Client quote preview</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {checks.map((check) => (
          <div key={check.mode} className="flex flex-col gap-1">
            <PreviewTile palette={check.palette} colour={colour} name={name} usesBrand={check.passes} />
            <span className="text-[11px] text-dim">{MODE_NAME[check.mode]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
