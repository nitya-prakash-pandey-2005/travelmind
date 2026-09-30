import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState, type FormEvent } from "react";
import { asApiError, needsGeneralError, type ApiError } from "../../api/client";
import {
  clientSuggestionsQueryOptions,
  dashboardApi,
  dashboardKeys,
  type Cabin,
  type Client,
  type EnquiryCreate,
} from "../../api/dashboard";
import type { Airport } from "../../api/types";
import { workspaceKeys } from "../../api/workspace";
import { clampGuests } from "../../lib/guests";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { FormError } from "../../ui/FormError";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { SelectField } from "../../ui/SelectField";
import { FIELD_CONTROL, FIELD_LABEL, FieldMessage, TextField } from "../../ui/TextField";
import { cn } from "../../ui/cn";
import { useToast } from "../../ui/toast/useToast";
import { AirportPicker } from "../airports/AirportPicker";
import { routeStore } from "../route/routeStore";

const MAX_ADULTS = 9;
const CABINS: ReadonlyArray<{ value: Cabin; label: string }> = [
  { value: "economy", label: "Economy" },
  { value: "premium_economy", label: "Premium economy" },
  { value: "business", label: "Business" },
  { value: "first", label: "First" },
];
type ClientMode = "existing" | "new";
const CLIENT_MODES = [
  { value: "existing", label: "Existing client" },
  { value: "new", label: "New client" },
] as const;
/** Fields this form shows errors for inline; errors on any other field get the general message. */
const RENDERED_FIELDS = ["origin", "destination", "depart_date", "return_date", "adults", "cabin", "notes", "name"];
const NAME_REQUIRED = "Enter the client's name, or pick an existing client.";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <FieldMessage id={id} error>
      {message}
    </FieldMessage>
  );
}

/** Search-as-you-type picker over the agency's clients (GET /api/v1/clients?q=). */
function ClientCombobox({ value, onChange }: { value: Client | null; onChange: (client: Client | null) => void }) {
  const id = useId();
  const listId = `${id}-list`;
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const settled = useDebouncedValue(term.trim(), 200);
  const suggestions = useQuery({ ...clientSuggestionsQueryOptions(settled), enabled: open && !value });
  // Only suggestions for what is typed now are shown (never an earlier term's), so a click always picks what it shows.
  const stale = settled !== term.trim();
  const results = stale ? [] : (suggestions.data?.items ?? []);
  const changeRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm text-ink">{value.name}</p>
          {(value.email || value.company_name) && (
            <p className="truncate text-xs text-dim">{[value.company_name, value.email].filter(Boolean).join(" · ")}</p>
          )}
        </div>
        <Button
          ref={changeRef}
          variant="secondary"
          size="sm"
          aria-label="Change client"
          onClick={() => {
            onChange(null);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        >
          Change
        </Button>
      </div>
    );
  }

  const choose = (client: Client) => {
    onChange(client);
    setTerm("");
    setOpen(false);
    requestAnimationFrame(() => changeRef.current?.focus());
  };
  const activeClient = open ? results[active] : undefined;

  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={id} className={FIELD_LABEL}>
        Client
      </label>
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeClient ? `${id}-opt-${active}` : undefined}
        autoComplete="off"
        placeholder="Search clients by name or email (optional)"
        value={term}
        className={cn(FIELD_CONTROL, "border-line-strong")}
        onChange={(event) => {
          setTerm(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (event.key === "Enter" && activeClient) {
            event.preventDefault();
            choose(activeClient);
          } else if (event.key === "Escape" && open) {
            // Close the list, not the dialog.
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Client suggestions"
          className="tm-popover absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-auto rounded-md py-1"
        >
          {results.map((client, index) => (
            <li
              key={client.id}
              id={`${id}-opt-${index}`}
              role="option"
              aria-selected={index === active}
              className={cn("flex cursor-pointer flex-col px-3 py-2 text-[13px]", index === active && "bg-selected")}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(client)}
            >
              <span className="truncate text-ink">{client.name}</span>
              {(client.company_name || client.email) && (
                <span className="truncate text-xs text-dim">
                  {[client.company_name, client.email].filter(Boolean).join(" · ")}
                </span>
              )}
            </li>
          ))}
          {(stale || suggestions.isFetching) && results.length === 0 && (
            <li role="presentation" className="px-3 py-2 text-xs text-dim">
              Searching…
            </li>
          )}
          {suggestions.isError && (
            <li role="presentation" className="px-3 py-2 text-[13px] text-danger">
              {asApiError(suggestions.error).message}
            </li>
          )}
          {!stale && !suggestions.isFetching && !suggestions.isError && suggestions.isSuccess && results.length === 0 && (
            <li role="presentation" className="px-3 py-2 text-[13px] text-dim">
              {term.trim() ? `No clients match “${term.trim()}”. Choose New client to add one.` : "No clients yet. Choose New client to add one."}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** The form, mounted only while the dialog is open so every opening starts fresh. */
function NewEnquiryForm({ onClose }: { onClose: () => void }) {
  const formId = useId();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [origin, setOrigin] = useState<Airport | null>(() => routeStore.get().origin);
  const [destination, setDestination] = useState<Airport | null>(() => routeStore.get().destination);
  const [departDate, setDepartDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [adults, setAdults] = useState("1");
  const [cabin, setCabin] = useState<Cabin>("economy");
  const [clientMode, setClientMode] = useState<ClientMode>("existing");
  const [client, setClient] = useState<Client | null>(null);
  const [clientName, setClientName] = useState("");
  const [notes, setNotes] = useState("");
  const [nameError, setNameError] = useState<string | undefined>();
  // A client created on an earlier attempt is reused, so a retry never adds a duplicate.
  const createdClient = useRef<Client | null>(null);
  const sameAirport = origin !== null && destination !== null && origin.iata_code === destination.iata_code;

  const create = useMutation({
    mutationFn: async () => {
      let clientId = clientMode === "existing" ? client?.id : undefined;
      if (clientMode === "new") {
        const name = clientName.trim();
        if (createdClient.current?.name !== name) createdClient.current = await dashboardApi.createClient({ name });
        clientId = createdClient.current.id;
      }
      const body: EnquiryCreate = {
        ...(clientId ? { client_id: clientId } : {}),
        ...(origin ? { origin: origin.iata_code } : {}),
        ...(destination ? { destination: destination.iata_code } : {}),
        ...(departDate ? { depart_date: departDate } : {}),
        ...(returnDate ? { return_date: returnDate } : {}),
        adults: clampGuests(adults, MAX_ADULTS),
        cabin,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
      return dashboardApi.createEnquiry(body);
    },
    onSuccess: (enquiry) => {
      toast({ tone: "ok", title: `Enquiry ${enquiry.number} created` });
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.enquiries });
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.onboarding });
      void queryClient.invalidateQueries({ queryKey: ["clients"] });
      onClose();
    },
  });

  const error: ApiError | null = create.error ? asApiError(create.error) : null;
  const fieldError = (field: string) => error?.fieldErrors[field];
  const showGeneral = error !== null && needsGeneralError(error, RENDERED_FIELDS);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (create.isPending || sameAirport) return;
    if (clientMode === "new" && !clientName.trim()) {
      setNameError(NAME_REQUIRED);
      return;
    }
    setNameError(undefined);
    setAdults(String(clampGuests(adults, MAX_ADULTS)));
    create.mutate();
  }

  const notesErrorId = `${formId}-notes-error`;

  return (
    <Dialog
      open
      onClose={onClose}
      title="New enquiry"
      description="Capture a trip request now; quote it when you're ready."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={create.isPending} disabled={sameAirport}>
            Create enquiry
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-4">
        {showGeneral && error && <FormError error={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <AirportPicker label="From" value={origin} onChange={setOrigin} />
            <FieldError id={`${formId}-origin-error`} message={fieldError("origin")} />
          </div>
          <div className="flex flex-col gap-1">
            <AirportPicker label="To" value={destination} onChange={setDestination} />
            <FieldError id={`${formId}-destination-error`} message={fieldError("destination")} />
          </div>
        </div>
        {sameAirport && <p className="-mt-2 text-[13px] text-warn">Pick two different airports.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Depart"
            type="date"
            value={departDate}
            onChange={(event) => setDepartDate(event.target.value)}
            error={fieldError("depart_date")}
          />
          <TextField
            label="Return"
            type="date"
            value={returnDate}
            min={departDate || undefined}
            onChange={(event) => setReturnDate(event.target.value)}
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
            value={adults}
            onChange={(event) => setAdults(event.target.value)}
            onBlur={() => setAdults(String(clampGuests(adults, MAX_ADULTS)))}
            error={fieldError("adults")}
          />
          <SelectField label="Cabin" value={cabin} onChange={(event) => setCabin(event.target.value as Cabin)}>
            {CABINS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectField>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Client</legend>
          <SegmentedControl
            label="Client type"
            options={CLIENT_MODES}
            value={clientMode}
            onChange={(mode) => {
              setClientMode(mode);
              setNameError(undefined);
            }}
            className="self-start"
          />
          {clientMode === "existing" ? (
            <ClientCombobox value={client} onChange={setClient} />
          ) : (
            <TextField
              label="Client name"
              autoComplete="off"
              value={clientName}
              onChange={(event) => setClientName(event.target.value)}
              error={nameError ?? fieldError("name")}
              hint="Saved to your clients, then linked to this enquiry."
            />
          )}
        </fieldset>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${formId}-notes`} className={FIELD_LABEL}>
            Notes
          </label>
          <textarea
            id={`${formId}-notes`}
            rows={3}
            value={notes}
            maxLength={2000}
            onChange={(event) => setNotes(event.target.value)}
            aria-invalid={fieldError("notes") ? true : undefined}
            aria-describedby={fieldError("notes") ? notesErrorId : undefined}
            placeholder="Preferences, budget, anything the client mentioned"
            className={cn(FIELD_CONTROL, "h-auto resize-y py-2", fieldError("notes") ? "border-danger" : "border-line-strong")}
          />
          <FieldError id={notesErrorId} message={fieldError("notes")} />
        </div>
      </form>
    </Dialog>
  );
}

/** Compact create-enquiry dialog: route, dates, travellers, cabin, client (existing or new) and notes. */
export function NewEnquiryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <NewEnquiryForm onClose={onClose} /> : null;
}
