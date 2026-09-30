import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter, useSearch } from "@tanstack/react-router";
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

/** Fields whose server errors show inline next to their input. */
const INLINE_FIELDS = ["email", "password"] as const;

export function LoginPage() {
  const search = useSearch({ from: "/login" });
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = useMutation({
    mutationFn: authApi.login,
    meta: { skipAuthRedirect: true },
    onSuccess: (me) => {
      // A different user (maybe another agency) may be signing in on this browser: drop the old data first.
      resetSessionState(queryClient);
      queryClient.setQueryData(qk.me, me);
      router.history.push(search.redirect ?? APP_HOME);
    },
  });
  const error = login.error instanceof ApiError ? login.error : null;
  const showGeneralError = error ? needsGeneralError(error, INLINE_FIELDS) : false;

  return (
    <AuthFrame title="Mission access" subtitle="Sign in to your agency's command deck.">
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          login.mutate({ email, password });
        }}
      >
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={error?.fieldErrors.email}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={error?.fieldErrors.password}
        />
        {error && showGeneralError && <FormError error={error} />}
        <Button type="submit" loading={login.isPending}>
          Engage
        </Button>
      </form>
      <p className="mt-6 text-sm text-dim">
        New agency?{" "}
        <Link to="/signup" className="text-primary hover:underline">
          Create your command deck
        </Link>
      </p>
    </AuthFrame>
  );
}
