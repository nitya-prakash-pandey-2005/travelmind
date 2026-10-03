import { useQuery } from "@tanstack/react-query";
import { Info, RotateCcw, Save } from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { AGENCY_NAME_MAX, AGENCY_NAME_MIN, useUpdateAgency, type AgencyUpdate } from "../../api/agency";
import { asApiError, needsGeneralError } from "../../api/client";
import type { Me } from "../../api/types";
import { agencyQueryOptions, type AgencyProfile } from "../../api/workspace";
import { useCurrentUser } from "../../auth/useCurrentUser";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { FormError } from "../../ui/FormError";
import { PageHeader } from "../../ui/PageHeader";
import { Panel } from "../../ui/Panel";
import { SelectField } from "../../ui/SelectField";
import { Skeleton } from "../../ui/Skeleton";
import { TextField } from "../../ui/TextField";
import { useToast } from "../../ui/toast/useToast";
import { PanelError } from "../command/PanelError";
import { BrandColourField } from "./BrandColourField";
import { brandChecks, isBrandColor, normaliseBrandInput } from "./brandContrast";
import { AppearancePanel, PrivacyPanel, TeamSummaryPanel, WorkspacePanel } from "./SidePanels";
import { timeZoneOptions } from "./timeZones";

const DESCRIPTION = "Your agency's profile and branding, used across the workspace and on client quote pages.";
const FORM_FIELDS = ["name", "timezone", "brand_color"] as const;
const HEX_MESSAGE = "Use # and six hex digits (0–9, a–f).";
const NAME_MESSAGE = `Use ${AGENCY_NAME_MIN} to ${AGENCY_NAME_MAX} characters.`;
const DEMO_NOTE =
  "Demo workspaces can't change settings. Create your own workspace to set your agency's name, time zone and brand colour.";
const AGENT_NOTE = "Only owners and admins can change agency settings.";

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const currencyNames = new Intl.DisplayNames(["en"], { type: "currency" });

function displayName(names: Intl.DisplayNames, code: string): string | undefined {
  try {
    const name = names.of(code);
    return name && name !== code ? name : undefined;
  } catch {
    return undefined;
  }
}

function countryLabel(code: string): string {
  const name = displayName(regionNames, code);
  return name ? `${name} (${code})` : code;
}

function currencyLabel(code: string): string {
  const name = displayName(currencyNames, code);
  return name ? `${code} · ${name}` : code;
}

function nameProblem(name: string): string | undefined {
  const length = name.trim().length;
  return length < AGENCY_NAME_MIN || length > AGENCY_NAME_MAX ? NAME_MESSAGE : undefined;
}

/** Why the form is read-only for this person, or null when they can change it. */
function lockNote(profile: AgencyProfile, me: Me): string | null {
  if (profile.is_demo) return DEMO_NOTE;
  if (me.user.role === "agent") return AGENT_NOTE;
  return null;
}

function ProfileForm({ profile, me }: { profile: AgencyProfile; me: Me }) {
  const { toast } = useToast();
  const update = useUpdateAgency();
  const locked = lockNote(profile, me);
  const saved = profile.brand_color.toLowerCase();
  const [name, setName] = useState(profile.name);
  const [timezone, setTimezone] = useState(profile.timezone);
  const [hex, setHex] = useState(saved);
  const [hexTouched, setHexTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const zones = useMemo(() => timeZoneOptions(profile.timezone), [profile.timezone]);

  const hexValid = isBrandColor(hex);
  const shown = hexValid ? hex : saved;
  const brandChanged = hexValid && hex !== saved;
  const blocked = brandChanged && brandChecks(hex).some((check) => !check.passes);
  const hexError = hexValid ? undefined : hex === "" ? (hexTouched ? "Enter a brand colour." : undefined) : hexTouched || hex.length >= 7 ? HEX_MESSAGE : undefined;

  const changes: AgencyUpdate = {};
  if (name.trim() !== profile.name) changes.name = name.trim();
  if (timezone !== profile.timezone) changes.timezone = timezone;
  if (brandChanged) changes.brand_color = hex;
  const dirty = Object.keys(changes).length > 0;

  const serverError = update.error ? asApiError(update.error) : null;
  const fieldError = (field: (typeof FORM_FIELDS)[number]) => serverError?.fieldErrors[field];
  const localNameError = submitted ? nameProblem(name) : undefined;

  function reset() {
    setName(profile.name);
    setTimezone(profile.timezone);
    setHex(saved);
    setHexTouched(false);
    setSubmitted(false);
    update.reset();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (locked || !dirty || !hexValid || blocked || nameProblem(name)) return;
    update.mutate(changes, {
      onSuccess: () => {
        setSubmitted(false);
        toast({ tone: "ok", title: "Settings saved", description: "Your agency profile is up to date." });
      },
    });
  }

  return (
    <form aria-label="Agency profile" noValidate onSubmit={submit} className="flex min-w-0 flex-col gap-4">
      {locked && (
        <p className="flex items-start gap-2.5 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 text-[13px] leading-5 text-ink">
          <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-info" />
          <span>{locked}</span>
        </p>
      )}
      <fieldset disabled={Boolean(locked)} className="flex min-w-0 flex-col gap-4">
        <Panel title="Agency profile" description="How your agency is named and when its day starts">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Agency name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={AGENCY_NAME_MAX}
              autoComplete="organization"
              hint="Shown in the top bar and on client quote pages."
              error={fieldError("name") ?? localNameError}
            />
            <SelectField
              label="Time zone"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              hint="Sets the agency's day for the Command Center and route intel."
              error={fieldError("timezone")}
            >
              {zones.map((zone) => (
                <option key={zone.value} value={zone.value}>
                  {zone.label}
                </option>
              ))}
            </SelectField>
            <TextField label="Country" value={countryLabel(profile.country_code)} readOnly />
            <TextField label="Currency" value={currencyLabel(profile.currency)} readOnly />
          </div>
          <p className="mt-3 flex items-start gap-2 text-xs leading-4 text-dim">
            <Info size={13} aria-hidden="true" className="mt-px shrink-0 text-faint" />
            <span>
              Country and currency were set when the workspace was created. Quotes, pipeline values and Command Center
              figures are in {profile.currency}.
            </span>
          </p>
        </Panel>

        <Panel title="Branding" description="Your colour on client quote pages, checked for contrast before it's saved">
          <BrandColourField
            agencyName={name.trim() || profile.name}
            text={hex}
            shown={shown}
            saved={saved}
            hexError={fieldError("brand_color") ?? hexError}
            blocked={blocked}
            disabled={Boolean(locked)}
            onText={(value) => setHex(normaliseBrandInput(value))}
            onBlur={() => setHexTouched(true)}
          />
        </Panel>
      </fieldset>

      {serverError && needsGeneralError(serverError, FORM_FIELDS) && <FormError error={serverError} />}

      {!locked && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3">
          <p className="text-xs leading-4 text-dim">
            {dirty ? "Unsaved changes. They apply to the whole workspace once saved." : "No unsaved changes."}
          </p>
          <div className="ml-auto flex items-center gap-2">
            {dirty && (
              <Button variant="ghost" size="sm" onClick={reset}>
                <RotateCcw size={14} aria-hidden="true" />
                Discard
              </Button>
            )}
            <Button type="submit" size="sm" disabled={!dirty || !hexValid || blocked} loading={update.isPending}>
              {!update.isPending && <Save size={14} aria-hidden="true" />}
              Save changes
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

function SettingsLayout({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">{main}</div>
      <div className="flex min-w-0 flex-col gap-4">{side}</div>
    </div>
  );
}

/** Agency settings: profile, branding with a contrast check, workspace facts, team, appearance and data handling. */
export function SettingsPage() {
  const me = useCurrentUser();
  const agency = useQuery(agencyQueryOptions);

  const header = (
    <PageHeader
      title="Settings"
      description={DESCRIPTION}
      meta={agency.data?.is_demo ? <Badge tone="warn">Demo · read-only</Badge> : undefined}
    />
  );

  if (!me) return header;
  if (agency.isError) {
    return (
      <>
        {header}
        <PanelError error={agency.error} onRetry={() => void agency.refetch()} retrying={agency.isFetching} />
      </>
    );
  }
  if (agency.isPending) {
    return (
      <>
        {header}
        <SettingsLayout
          main={
            <div aria-busy="true" className="flex flex-col gap-4">
              <span className="sr-only">Loading settings…</span>
              <Panel title="Agency profile">
                <Skeleton lines={4} />
              </Panel>
              <Panel title="Branding">
                <Skeleton lines={5} />
              </Panel>
            </div>
          }
          side={
            <Panel title="Workspace">
              <Skeleton lines={5} />
            </Panel>
          }
        />
      </>
    );
  }

  const profile = agency.data;
  return (
    <>
      {header}
      <SettingsLayout
        main={
          <>
            <ProfileForm key={`${profile.name}|${profile.timezone}|${profile.brand_color}`} profile={profile} me={me} />
            <PrivacyPanel />
          </>
        }
        side={
          <>
            <WorkspacePanel profile={profile} me={me} />
            <TeamSummaryPanel />
            <AppearancePanel />
          </>
        }
      />
    </>
  );
}
