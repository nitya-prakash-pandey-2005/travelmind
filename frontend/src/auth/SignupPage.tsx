import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { authApi, type SignupInput } from "../api/auth";
import { ApiError } from "../api/client";
import { qk } from "../api/queries";
import { Button } from "../ui/Button";
import { FormError } from "../ui/FormError";
import { TextField } from "../ui/TextField";
import { AuthFrame } from "./AuthFrame";

const EMPTY: SignupInput = { agency_name: "", full_name: "", email: "", password: "" };

export function SignupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SignupInput>(EMPTY);
  const signup = useMutation({
    mutationFn: authApi.signup,
    meta: { skipAuthRedirect: true },
    onSuccess: async (me) => {
      queryClient.setQueryData(qk.me, me);
      await navigate({ to: "/" });
    },
  });
  const error = signup.error instanceof ApiError ? signup.error : null;
  const fieldErrors = error?.fieldErrors ?? {};
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  const update = (field: keyof SignupInput) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  return (
    <AuthFrame title="Launch your agency" subtitle="Create a command deck for your team. Takes a minute.">
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          signup.mutate(form);
        }}
      >
        <TextField label="Agency name" required value={form.agency_name} onChange={update("agency_name")} error={fieldErrors.agency_name} />
        <TextField label="Your name" autoComplete="name" required value={form.full_name} onChange={update("full_name")} error={fieldErrors.full_name} />
        <TextField label="Email" type="email" autoComplete="email" required value={form.email} onChange={update("email")} error={fieldErrors.email} />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          hint="At least 10 characters"
          value={form.password}
          onChange={update("password")}
          error={fieldErrors.password}
        />
        {error && !hasFieldErrors && <FormError error={error} />}
        <Button type="submit" loading={signup.isPending}>
          Create command deck
        </Button>
      </form>
      <p className="mt-6 text-sm text-dim">
        Already aboard?{" "}
        <Link to="/login" className="text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </AuthFrame>
  );
}
