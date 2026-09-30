import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { authApi } from "../api/auth";
import { ApiError, needsGeneralError } from "../api/client";
import { qk } from "../api/queries";
import { APP_HOME } from "../app/paths";
import { Button } from "../ui/Button";
import { FormError } from "../ui/FormError";
import { TextField } from "../ui/TextField";
import { AuthFrame } from "./AuthFrame";
import { resetSessionState } from "./resetSessionState";

/** Fields whose server errors show inline next to their input; the token comes from the link. */
const INLINE_FIELDS = ["full_name", "password"] as const;

export function AcceptInvitePage() {
  const { token } = useParams({ from: "/invite/$token" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const accept = useMutation({
    mutationFn: authApi.acceptInvitation,
    meta: { skipAuthRedirect: true },
    onSuccess: async (me) => {
      // A different user (maybe another agency) may be signing in on this browser: drop the old data first.
      resetSessionState(queryClient);
      queryClient.setQueryData(qk.me, me);
      await navigate({ to: APP_HOME });
    },
  });
  const error = accept.error instanceof ApiError ? accept.error : null;
  const fieldErrors = error?.fieldErrors ?? {};
  const showGeneralError = error ? needsGeneralError(error, INLINE_FIELDS) : false;

  return (
    <AuthFrame title="Join your crew" subtitle="Set your name and password to board your agency's deck.">
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          accept.mutate({ token, full_name: fullName, password });
        }}
      >
        <TextField label="Your name" autoComplete="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} error={fieldErrors.full_name} />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          hint="At least 10 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
        />
        {error && showGeneralError && <FormError error={error} />}
        <Button type="submit" loading={accept.isPending}>
          Join the crew
        </Button>
      </form>
      <p className="mt-6 text-sm text-dim">
        Already have an account?{" "}
        <Link to="/login" className="text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </AuthFrame>
  );
}
