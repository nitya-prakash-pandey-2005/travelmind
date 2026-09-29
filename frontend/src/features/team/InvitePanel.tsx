import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, asApiError } from "../../api/client";
import { invitationsQueryOptions, qk } from "../../api/queries";
import { teamApi } from "../../api/team";
import type { InvitationCreated } from "../../api/types";
import { formatDate } from "../../lib/format";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { FormError } from "../../ui/FormError";
import { Panel } from "../../ui/Panel";
import { TextField } from "../../ui/TextField";

type InviteRole = "agent" | "admin";

export function InvitePanel() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("agent");
  const [created, setCreated] = useState<InvitationCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const pending = useQuery(invitationsQueryOptions);
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
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  const link = created ? `${window.location.origin}/invite/${created.token}` : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Panel eyebrow="Invitations" title="Invite crew">
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          invite.mutate({ email, role });
        }}
      >
        <TextField
          label="Crew member email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrors.email}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="invite-role" className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">
            Role
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(event) => setRole(event.target.value as InviteRole)}
            className="h-10 rounded-sm border border-line bg-void/60 px-2 text-ink outline-none focus:border-primary"
          >
            <option value="agent">Agent</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        {error && !hasFieldErrors && <FormError error={error} />}
        <Button type="submit" loading={invite.isPending}>
          Generate invitation
        </Button>
      </form>

      {created && (
        <div className="mt-5 flex flex-col gap-2 rounded-sm border border-primary/40 bg-primary/5 p-3">
          <label htmlFor="invite-link" className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary">
            Invitation link
          </label>
          <div className="flex gap-2">
            <input
              id="invite-link"
              readOnly
              value={link}
              onFocus={(event) => event.currentTarget.select()}
              className="h-9 min-w-0 flex-1 rounded-sm border border-line bg-void/60 px-2 font-mono text-xs text-ink"
            />
            <Button size="sm" variant="ghost" onClick={copy}>
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
          <p className="text-xs text-dim">
            Shown once — send it to {created.email} now. It expires on {formatDate(created.expires_at)}.
          </p>
        </div>
      )}

      <h3 className="mb-2 mt-6 font-mono text-[11px] uppercase tracking-[0.22em] text-dim">Pending</h3>
      {pending.isPending ? (
        <p role="status" className="font-mono text-xs uppercase tracking-[0.2em] text-dim">
          Loading invitations…
        </p>
      ) : pending.isError ? (
        <FormError error={asApiError(pending.error)} />
      ) : pending.data.length > 0 ? (
        <ul aria-label="Pending invitations" className="flex flex-col gap-2">
          {pending.data.map((invitation) => (
            <li key={invitation.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate text-ink">{invitation.email}</span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge tone={invitation.role === "admin" ? "primary" : "neutral"}>{invitation.role}</Badge>
                <span className="text-xs text-dim">expires {formatDate(invitation.expires_at)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <ul aria-label="Pending invitations">
          <li className="text-sm text-dim">No pending invitations.</li>
        </ul>
      )}
    </Panel>
  );
}
