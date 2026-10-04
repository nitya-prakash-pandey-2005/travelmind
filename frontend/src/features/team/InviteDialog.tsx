import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, CircleCheck, Copy } from "lucide-react";
import { useId, useState } from "react";
import { ApiError, needsGeneralError } from "../../api/client";
import { qk } from "../../api/queries";
import { teamApi } from "../../api/team";
import type { InvitationCreated } from "../../api/types";
import { formatDate } from "../../lib/format";
import { Button } from "../../ui/Button";
import { Drawer } from "../../ui/Drawer";
import { FormError } from "../../ui/FormError";
import { SelectField } from "../../ui/SelectField";
import { FIELD_CONTROL, FIELD_LABEL, TextField } from "../../ui/TextField";

type InviteRole = "agent" | "admin";

const ROLE_HINT: Record<InviteRole, string> = {
  agent: "Searches fares and hotels and handles enquiries and quotes.",
  admin: "Everything an agent can do, plus inviting teammates.",
};

/** Fields whose server errors show inline next to their input; the role select has no error slot. */
const INLINE_FIELDS = ["email"] as const;

/**
 * Invite a teammate: email and role in, a one-time link out. Mounted only while open, so each opening
 * starts with an empty form.
 */
export function InviteDialog({ agencyName, onClose }: { agencyName: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const formId = useId();
  const linkId = useId();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("agent");
  const [created, setCreated] = useState<InvitationCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const invite = useMutation({
    mutationFn: teamApi.createInvitation,
    onSuccess: async (invitation) => {
      setCreated(invitation);
      setCopied(false);
      setEmail("");
      await queryClient.invalidateQueries({ queryKey: qk.invitations });
    },
  });
  const error = invite.error instanceof ApiError ? invite.error : null;
  const fieldErrors = error?.fieldErrors ?? {};
  const showGeneralError = error ? needsGeneralError(error, INLINE_FIELDS) : false;
  const link = created ? `${window.location.origin}/invite/${created.token}` : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const inviteAnother = () => {
    setCreated(null);
    invite.reset();
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title="Invite teammate"
      description={`They get a one-time link to join ${agencyName.trimEnd().replace(/\.+$/, "")}.`}
      footer={
        created ? (
          <>
            <Button variant="secondary" onClick={inviteAnother}>
              Invite another
            </Button>
            <Button onClick={onClose}>Done</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={invite.isPending}>
              Create invite link
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="flex flex-col gap-4">
          <p role="status" className="flex items-center gap-2 text-[13px] text-ok">
            <CircleCheck size={15} aria-hidden="true" className="shrink-0" />
            Invite link created for {created.email}
          </p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={linkId} className={FIELD_LABEL}>
              Invitation link
            </label>
            <div className="flex gap-2">
              <input
                id={linkId}
                readOnly
                data-autofocus
                value={link}
                onFocus={(event) => event.currentTarget.select()}
                className={`${FIELD_CONTROL} border-line-strong font-mono text-xs`}
              />
              <Button variant="secondary" onClick={copy}>
                {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
          </div>
          <p className="text-xs leading-4 text-dim">
            Shown once. Send it to {created.email} now; it expires on {formatDate(created.expires_at)}.
          </p>
        </div>
      ) : (
        <form
          id={formId}
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            invite.mutate({ email, role });
          }}
        >
          {error && showGeneralError && <FormError error={error} />}
          <TextField
            label="Email"
            type="email"
            required
            autoComplete="off"
            placeholder="name@agency.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={fieldErrors.email}
          />
          <SelectField
            label="Role"
            value={role}
            hint={ROLE_HINT[role]}
            onChange={(event) => setRole(event.target.value as InviteRole)}
          >
            <option value="agent">Agent</option>
            <option value="admin">Admin</option>
          </SelectField>
        </form>
      )}
    </Drawer>
  );
}
