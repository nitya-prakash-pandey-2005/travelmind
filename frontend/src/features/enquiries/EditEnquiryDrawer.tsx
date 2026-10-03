import { useQuery } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { asApiError, needsGeneralError } from "../../api/client";
import { useUpdateEnquiry, type EnquiryOut, type EnquiryUpdate } from "../../api/enquiries";
import type { Cabin } from "../../api/offers";
import { teamQueryOptions } from "../../api/queries";
import { useCurrentUser } from "../../auth/useCurrentUser";
import { currencyExponent } from "../../lib/money";
import { Button } from "../../ui/Button";
import { Drawer } from "../../ui/Drawer";
import { FormError } from "../../ui/FormError";
import { SelectField } from "../../ui/SelectField";
import { FIELD_CONTROL, FIELD_LABEL, FieldMessage, TextField } from "../../ui/TextField";
import { cn } from "../../ui/cn";
import { useToast } from "../../ui/toast/useToast";
import { ClientCombobox, type ClientChoice } from "../command/NewEnquiryDialog";

const CABINS: ReadonlyArray<{ value: Cabin; label: string }> = [
  { value: "economy", label: "Economy" },
  { value: "premium_economy", label: "Premium economy" },
  { value: "business", label: "Business" },
  { value: "first", label: "First" },
];
const MAX_ADULTS = 9;
const MAX_CHILD_AGE = 17;
const RENDERED_FIELDS = [
  "client_id",
  "origin",
  "destination",
  "depart_date",
  "return_date",
  "adults",
  "children_ages",
  "cabin",
  "budget_minor",
  "budget_currency",
  "notes",
  "assignee_user_id",
];

/** "4, 9" → [4, 9]; null when any part isn't an age from 0 to 17. */
function parseAges(text: string): number[] | null {
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  const ages = parts.map(Number);
  return ages.every((age) => Number.isInteger(age) && age >= 0 && age <= MAX_CHILD_AGE) ? ages : null;
}

function majorUnits(minor: number, currency: string): string {
  return String(minor / 10 ** currencyExponent(currency));
}

type Draft = {
  client: ClientChoice | null;
  origin: string;
  destination: string;
  depart: string;
  returning: string;
  adults: string;
  children: string;
  cabin: Cabin;
  budget: string;
  assignee: string;
  notes: string;
};

function draftOf(enquiry: EnquiryOut): Draft {
  return {
    client: enquiry.client,
    origin: enquiry.origin ?? "",
    destination: enquiry.destination ?? "",
    depart: enquiry.depart_date ?? "",
    returning: enquiry.return_date ?? "",
    adults: String(enquiry.adults),
    children: enquiry.children_ages.join(", "),
    cabin: (CABINS.some((c) => c.value === enquiry.cabin) ? enquiry.cabin : "economy") as Cabin,
    budget: enquiry.budget ? majorUnits(enquiry.budget.amount_minor, enquiry.budget.currency) : "",
    assignee: enquiry.assignee?.id ?? "",
    notes: enquiry.notes ?? "",
  };
}

const orNull = (value: string) => (value.trim() ? value.trim() : null);

function EditEnquiryForm({ enquiry, onClose }: { enquiry: EnquiryOut; onClose: () => void }) {
  const formId = useId();
  const me = useCurrentUser();
  const team = useQuery(teamQueryOptions);
  const update = useUpdateEnquiry();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(() => draftOf(enquiry));
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const budgetCurrency = enquiry.budget?.currency ?? me?.agency.currency ?? "INR";

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const error = update.error ? asApiError(update.error) : null;
  const fieldError = (field: string) => localErrors[field] ?? error?.fieldErrors[field];
  const showGeneral = error !== null && needsGeneralError(error, RENDERED_FIELDS);

  /** Only what changed: the server leaves omitted fields alone. */
  function changes(): { body: EnquiryUpdate; errors: Record<string, string> } {
    const body: EnquiryUpdate = {};
    const errors: Record<string, string> = {};
    const original = draftOf(enquiry);
    if ((draft.client?.id ?? null) !== (enquiry.client?.id ?? null)) body.client_id = draft.client?.id ?? null;
    for (const [key, field] of [
      ["origin", "origin"],
      ["destination", "destination"],
    ] as const) {
      const code = draft[key].trim().toUpperCase();
      if (code && !/^[A-Z]{3}$/.test(code)) errors[field] = "Enter a three-letter airport code, like DEL.";
      else if (code !== original[key]) body[field] = code || null;
    }
    if (draft.depart !== original.depart) body.depart_date = orNull(draft.depart);
    if (draft.returning !== original.returning) body.return_date = orNull(draft.returning);
    const adults = Number(draft.adults);
    if (!Number.isInteger(adults) || adults < 1 || adults > MAX_ADULTS) errors.adults = `Enter 1 to ${MAX_ADULTS} adults.`;
    else if (adults !== enquiry.adults) body.adults = adults;
    const ages = parseAges(draft.children);
    if (ages === null) errors.children_ages = "Enter ages from 0 to 17, separated by commas.";
    else if (ages.join(",") !== enquiry.children_ages.join(",")) body.children_ages = ages;
    if (draft.cabin !== original.cabin) body.cabin = draft.cabin;
    if (draft.budget.trim() !== original.budget) {
      if (!draft.budget.trim()) {
        body.budget_minor = null;
        body.budget_currency = null;
      } else {
        const amount = Number(draft.budget);
        if (!Number.isFinite(amount) || amount < 0) errors.budget_minor = "Enter the budget as an amount, like 45000.";
        else {
          body.budget_minor = Math.round(amount * 10 ** currencyExponent(budgetCurrency));
          body.budget_currency = budgetCurrency;
        }
      }
    }
    if (draft.assignee !== original.assignee) body.assignee_user_id = draft.assignee || null;
    if (draft.notes.trim() !== original.notes.trim()) body.notes = orNull(draft.notes);
    return { body, errors };
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (update.isPending) return;
    const { body, errors } = changes();
    setLocalErrors(errors);
    if (Object.keys(errors).length > 0) return;
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    update.mutate(
      { id: enquiry.id, changes: body },
      {
        onSuccess: (saved) => {
          toast({ tone: "ok", title: `${saved.number} saved` });
          onClose();
        },
      },
    );
  }

  const notesId = `${formId}-notes`;
  const notesError = fieldError("notes");

  return (
    <Drawer
      open
      onClose={onClose}
      title={`Edit ${enquiry.number}`}
      description="Trip, travellers, client and owner. Changes are recorded on the timeline."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={update.isPending}>
            Save changes
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-4">
        {showGeneral && error && <FormError error={error} />}
        <ClientCombobox value={draft.client} onChange={(client) => set("client", client)} />
        {fieldError("client_id") && (
          <FieldMessage id={`${formId}-client-error`} error>
            {fieldError("client_id") ?? ""}
          </FieldMessage>
        )}
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="From"
            value={draft.origin}
            maxLength={3}
            autoComplete="off"
            spellCheck={false}
            placeholder="DEL"
            className="[&_input]:font-mono [&_input]:uppercase"
            onChange={(event) => set("origin", event.target.value.toUpperCase())}
            error={fieldError("origin")}
          />
          <TextField
            label="To"
            value={draft.destination}
            maxLength={3}
            autoComplete="off"
            spellCheck={false}
            placeholder="BOM"
            className="[&_input]:font-mono [&_input]:uppercase"
            onChange={(event) => set("destination", event.target.value.toUpperCase())}
            error={fieldError("destination")}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Depart" type="date" value={draft.depart} onChange={(event) => set("depart", event.target.value)} error={fieldError("depart_date")} />
          <TextField
            label="Return"
            type="date"
            value={draft.returning}
            min={draft.depart || undefined}
            onChange={(event) => set("returning", event.target.value)}
            error={fieldError("return_date")}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Adults"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_ADULTS}
            value={draft.adults}
            onChange={(event) => set("adults", event.target.value)}
            error={fieldError("adults")}
          />
          <TextField
            label="Children's ages"
            inputMode="numeric"
            placeholder="e.g. 4, 9"
            value={draft.children}
            onChange={(event) => set("children", event.target.value)}
            error={fieldError("children_ages")}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Cabin" value={draft.cabin} onChange={(event) => set("cabin", event.target.value as Cabin)}>
            {CABINS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectField>
          <TextField
            label={`Budget (${budgetCurrency})`}
            type="number"
            inputMode="decimal"
            min={0}
            placeholder="Optional"
            value={draft.budget}
            onChange={(event) => set("budget", event.target.value)}
            error={fieldError("budget_minor") ?? fieldError("budget_currency")}
          />
        </div>
        <SelectField
          label="Assignee"
          value={draft.assignee}
          onChange={(event) => set("assignee", event.target.value)}
          error={fieldError("assignee_user_id")}
          hint={team.isError ? "Couldn't load the team; the current assignee is kept." : undefined}
        >
          <option value="">Unassigned</option>
          {enquiry.assignee && !(team.data ?? []).some((member) => member.id === enquiry.assignee?.id) && (
            <option value={enquiry.assignee.id}>{enquiry.assignee.full_name}</option>
          )}
          {(team.data ?? []).map((member) => (
            <option key={member.id} value={member.id}>
              {member.full_name}
            </option>
          ))}
        </SelectField>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={notesId} className={FIELD_LABEL}>
            Notes
          </label>
          <textarea
            id={notesId}
            rows={4}
            maxLength={2000}
            value={draft.notes}
            onChange={(event) => set("notes", event.target.value)}
            aria-invalid={notesError ? true : undefined}
            aria-describedby={notesError ? `${notesId}-error` : undefined}
            placeholder="Preferences, budget, anything the client mentioned"
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

/** Side panel editing every field of an enquiry; saves only what changed. */
export function EditEnquiryDrawer({ enquiry, open, onClose }: { enquiry: EnquiryOut; open: boolean; onClose: () => void }) {
  return open ? <EditEnquiryForm enquiry={enquiry} onClose={onClose} /> : null;
}
