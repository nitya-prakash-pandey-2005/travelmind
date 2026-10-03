import { X } from "lucide-react";
import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { asApiError, type ApiError } from "../../api/client";
import {
  MAX_CLIENT_TAGS,
  useCreateClient,
  useUpdateClient,
  type ClientCreate,
  type ClientKind,
  type ClientOut,
  type ClientUpdate,
} from "../../api/clients";
import type { Airport } from "../../api/types";
import { Button } from "../../ui/Button";
import { Drawer } from "../../ui/Drawer";
import { FormError } from "../../ui/FormError";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { FIELD_CONTROL, FIELD_LABEL, FieldMessage, TextField } from "../../ui/TextField";
import { cn } from "../../ui/cn";
import { useToast } from "../../ui/toast/useToast";
import { AirportPicker } from "../airports/AirportPicker";
import { airportStub, useAirport } from "./clientFacts";

const KINDS = [
  { value: "individual", label: "Individual" },
  { value: "company", label: "Company" },
] as const;
const MAX_TAG_LENGTH = 40;
const MAX_NOTES = 2000;

/** What to say under a field the server refused; its own wording is written for developers. */
const FIELD_MESSAGES: Record<string, string> = {
  name: "Enter a name of up to 200 characters, on one line.",
  email: "Enter a valid email address, like name@example.com.",
  phone: "Enter a phone number of up to 40 characters.",
  company_name: "Enter a company name of up to 200 characters, on one line.",
  home_airport: "Pick an airport from the list.",
  notes: "Keep notes to 2,000 characters.",
  tags: `Use up to ${MAX_CLIENT_TAGS} tags of up to ${MAX_TAG_LENGTH} characters each.`,
};

/** The server's refusal as inline field messages, plus whether anything is left for a general message. */
function serverErrors(error: ApiError | null): { fields: Record<string, string>; general: boolean } {
  if (!error) return { fields: {}, general: false };
  const fields: Record<string, string> = {};
  let general = false;
  for (const raw of Object.keys(error.fieldErrors)) {
    const field = raw.startsWith("tags") ? "tags" : raw;
    const message = FIELD_MESSAGES[field];
    if (message) fields[field] = message;
    else general = true;
  }
  if (Object.keys(error.fieldErrors).length === 0) {
    if (error.status === 409 && /email/i.test(error.message)) fields.email = error.message;
    else if (error.status === 422 && /airport/i.test(error.message)) fields.home_airport = error.message;
    else general = true;
  }
  return { fields, general };
}

type Draft = {
  kind: ClientKind;
  name: string;
  email: string;
  phone: string;
  company: string;
  airport: Airport | null;
  tags: string[];
  notes: string;
};

function draftOf(client: ClientOut | undefined): Draft {
  return {
    kind: client?.kind === "company" ? "company" : "individual",
    name: client?.name ?? "",
    email: client?.email ?? "",
    phone: client?.phone ?? "",
    company: client?.company_name ?? "",
    airport: client?.home_airport ? airportStub(client.home_airport) : null,
    tags: client?.tags ?? [],
    notes: client?.notes ?? "",
  };
}

const orNull = (value: string) => value.trim() || null;

/** The fields as the API takes them (blank optional fields as null). */
function payloadOf(draft: Draft): Required<ClientCreate> {
  return {
    kind: draft.kind,
    name: draft.name.trim(),
    email: orNull(draft.email),
    phone: orNull(draft.phone),
    company_name: orNull(draft.company),
    home_airport: draft.airport?.iata_code ?? null,
    tags: draft.tags,
    notes: orNull(draft.notes),
  };
}

/** Only the fields that differ from the saved record: the server leaves omitted fields alone. */
function changesOf(client: ClientOut, draft: Draft): ClientUpdate {
  const next = payloadOf(draft);
  const saved = payloadOf(draftOf(client));
  const changes: ClientUpdate = {};
  for (const key of Object.keys(next) as Array<keyof ClientCreate>) {
    const a = next[key];
    const b = saved[key];
    const same = Array.isArray(a) && Array.isArray(b) ? a.join("\u0000") === b.join("\u0000") : a === b;
    if (!same) Object.assign(changes, { [key]: a });
  }
  return changes;
}

/** Chips plus a text box: Enter or comma adds a tag, Backspace on an empty box removes the last. */
function TagsInput({
  tags,
  onChange,
  suggestions,
  error,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions: readonly string[];
  error?: string;
}) {
  const id = useId();
  const listId = `${id}-suggestions`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const [text, setText] = useState("");
  const [localError, setLocalError] = useState<string | undefined>();
  const full = tags.length >= MAX_CLIENT_TAGS;
  const shownError = localError ?? error;

  function add(): boolean {
    const tag = text.trim().toLowerCase();
    if (!tag) return false;
    if (tag.length > MAX_TAG_LENGTH) {
      setLocalError(`Keep each tag to ${MAX_TAG_LENGTH} characters.`);
      return true;
    }
    if (!tags.includes(tag)) {
      if (full) {
        setLocalError(`A client can have up to ${MAX_CLIENT_TAGS} tags.`);
        return true;
      }
      onChange([...tags, tag]);
    }
    setText("");
    setLocalError(undefined);
    return true;
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      // Enter adds the tag instead of submitting the form; with nothing typed it submits as usual.
      if (add() || event.key === ",") event.preventDefault();
    } else if (event.key === "Backspace" && !text && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={FIELD_LABEL}>
        Tags
      </label>
      <div
        className={cn(
          "flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border bg-surface-2 px-1.5 py-1",
          "transition-colors duration-150 ease-tm focus-within:border-primary",
          shownError ? "border-danger" : "border-line-strong hover:border-faint",
        )}
      >
        {tags.map((tag) => (
          <span key={tag} className="inline-flex h-6 items-center gap-1 rounded-[4px] border border-line bg-surface pl-2 pr-0.5 text-xs text-ink">
            {tag}
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              className="grid h-5 w-5 place-items-center rounded-[3px] text-dim transition-colors duration-150 ease-tm hover:bg-hover hover:text-ink"
            >
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          id={id}
          list={listId}
          value={text}
          autoComplete="off"
          maxLength={MAX_TAG_LENGTH + 10}
          placeholder={tags.length === 0 ? "e.g. vip, corporate, family" : full ? "" : "Add a tag"}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={shownError ? errorId : hintId}
          onChange={(event) => {
            setText(event.target.value.replace(",", ""));
            setLocalError(undefined);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => void add()}
          className="h-7 min-w-24 flex-1 bg-transparent px-1.5 text-sm text-ink outline-none placeholder:text-faint"
        />
        <datalist id={listId}>
          {suggestions
            .filter((tag) => !tags.includes(tag))
            .map((tag) => (
              <option key={tag} value={tag} />
            ))}
        </datalist>
      </div>
      {shownError ? (
        <FieldMessage id={errorId} error>
          {shownError}
        </FieldMessage>
      ) : (
        <FieldMessage id={hintId}>{`Press Enter to add. Up to ${MAX_CLIENT_TAGS} tags; ${tags.length} used.`}</FieldMessage>
      )}
    </div>
  );
}

function ClientForm({
  client,
  onClose,
  onSaved,
  tagSuggestions,
}: {
  client?: ClientOut;
  onClose: () => void;
  onSaved?: (client: ClientOut) => void;
  tagSuggestions: readonly string[];
}) {
  const formId = useId();
  const { toast } = useToast();
  const create = useCreateClient();
  const update = useUpdateClient();
  const mutation = client ? update : create;
  const [draft, setDraft] = useState<Draft>(() => draftOf(client));
  const [nameError, setNameError] = useState<string | undefined>();
  const resolvedAirport = useAirport(client?.home_airport);
  // The saved airport starts as a code-only stub; show the full record once it has loaded.
  const airport = draft.airport && resolvedAirport?.iata_code === draft.airport.iata_code ? resolvedAirport : draft.airport;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const error = mutation.error ? asApiError(mutation.error) : null;
  const server = serverErrors(error);
  const fieldError = (field: string) => (field === "name" ? (nameError ?? server.fields.name) : server.fields[field]);
  const company = draft.kind === "company";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;
    if (!draft.name.trim()) {
      setNameError("Enter the client's name.");
      return;
    }
    setNameError(undefined);
    if (!client) {
      create.mutate(payloadOf(draft), {
        onSuccess: (saved) => {
          toast({ tone: "ok", title: "Client added", description: saved.name });
          onClose();
          onSaved?.(saved);
        },
      });
      return;
    }
    const changes = changesOf(client, draft);
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    update.mutate(
      { id: client.id, changes },
      {
        onSuccess: (saved) => {
          toast({ tone: "ok", title: "Changes saved", description: saved.name });
          onClose();
          onSaved?.(saved);
        },
      },
    );
  }

  const notesId = `${formId}-notes`;
  const notesError = fieldError("notes");
  const airportError = fieldError("home_airport");

  return (
    <Drawer
      open
      onClose={onClose}
      title={client ? `Edit ${client.name}` : "New client"}
      description={
        client
          ? "Contact details, tags and notes. Changes are recorded on the client's timeline."
          : "A traveller or company you quote for. Only the name is required."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={mutation.isPending}>
            {client ? "Save changes" : "Add client"}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-4">
        {server.general && error && <FormError error={error} />}
        <div className="flex flex-col gap-1.5">
          <p className={FIELD_LABEL}>Type</p>
          <SegmentedControl label="Client type" options={KINDS} value={draft.kind} onChange={(kind) => set("kind", kind)} className="self-start" />
        </div>
        <TextField
          label="Name"
          autoComplete="off"
          value={draft.name}
          maxLength={200}
          onChange={(event) => set("name", event.target.value)}
          error={fieldError("name")}
          hint={company ? "The company's trading name." : "Full name, as on their passport."}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Email"
            type="email"
            autoComplete="off"
            value={draft.email}
            onChange={(event) => set("email", event.target.value)}
            error={fieldError("email")}
          />
          <TextField
            label="Phone"
            type="tel"
            autoComplete="off"
            value={draft.phone}
            maxLength={40}
            onChange={(event) => set("phone", event.target.value)}
            error={fieldError("phone")}
          />
        </div>
        <TextField
          label="Company"
          autoComplete="off"
          value={draft.company}
          maxLength={200}
          onChange={(event) => set("company", event.target.value)}
          error={fieldError("company_name")}
          hint={company ? "Legal or billing name, if different." : "Where they work, for corporate travel."}
        />
        <div className="flex flex-col gap-1">
          <AirportPicker label="Home airport" value={airport} onChange={(next) => set("airport", next)} />
          {airportError ? (
            <FieldMessage id={`${formId}-airport-error`} error>
              {airportError}
            </FieldMessage>
          ) : (
            <FieldMessage id={`${formId}-airport-hint`}>Where their trips usually start.</FieldMessage>
          )}
        </div>
        <TagsInput tags={draft.tags} onChange={(tags) => set("tags", tags)} suggestions={tagSuggestions} error={fieldError("tags")} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={notesId} className={FIELD_LABEL}>
            Notes
          </label>
          <textarea
            id={notesId}
            rows={4}
            maxLength={MAX_NOTES}
            value={draft.notes}
            onChange={(event) => set("notes", event.target.value)}
            aria-invalid={notesError ? true : undefined}
            aria-describedby={notesError ? `${notesId}-error` : undefined}
            placeholder="Seat and meal preferences, loyalty numbers, who books for them"
            className={cn(FIELD_CONTROL, "h-auto resize-y py-2", notesError ? "border-danger" : "border-line-strong")}
          />
          {notesError && (
            <FieldMessage id={`${notesId}-error`} error>
              {notesError}
            </FieldMessage>
          )}
        </div>
      </form>
    </Drawer>
  );
}

/**
 * Side panel to add a client (no `client`) or edit one (saves only what changed). Server checks
 * (email format, duplicate email, unknown airport, tag limits) show next to their fields.
 */
export function ClientFormDrawer({
  open,
  onClose,
  client,
  onSaved,
  tagSuggestions = [],
}: {
  open: boolean;
  onClose: () => void;
  client?: ClientOut;
  onSaved?: (client: ClientOut) => void;
  /** Tags already used in the agency, offered as the user types. */
  tagSuggestions?: readonly string[];
}) {
  return open ? <ClientForm client={client} onClose={onClose} onSaved={onSaved} tagSuggestions={tagSuggestions} /> : null;
}
