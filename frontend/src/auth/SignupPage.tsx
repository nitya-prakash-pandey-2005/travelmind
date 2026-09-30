import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { authApi, SIGNUP_COUNTRIES, type SignupCountryCode, type SignupInput } from "../api/auth";
import { ApiError, needsGeneralError } from "../api/client";
import { qk } from "../api/queries";
import { APP_HOME } from "../app/paths";
import { Button } from "../ui/Button";
import { FormError } from "../ui/FormError";
import { SelectField } from "../ui/SelectField";
import { TextField } from "../ui/TextField";
import { AUTH_LINK, AuthFrame } from "./AuthFrame";
import { PASSWORD_RULE } from "./passwordRule";
import { resetSessionState } from "./resetSessionState";

/** Fields whose server errors show inline next to their input. */
const INLINE_FIELDS = [
  "agency_name",
  "full_name",
  "email",
  "password",
  "country_code",
] as const satisfies readonly (keyof SignupInput)[];

const EMPTY: SignupInput = { agency_name: "", full_name: "", email: "", password: "", country_code: "IN" };

export function SignupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SignupInput>(EMPTY);
  const signup = useMutation({
    mutationFn: authApi.signup,
    meta: { skipAuthRedirect: true },
    onSuccess: async (me) => {
      // A different user (maybe another agency) may be signing in on this browser: drop the old data first.
      resetSessionState(queryClient);
      queryClient.setQueryData(qk.me, me);
      await navigate({ to: APP_HOME });
    },
  });
  const error = signup.error instanceof ApiError ? signup.error : null;
  const fieldErrors = error?.fieldErrors ?? {};
  const showGeneralError = error ? needsGeneralError(error, INLINE_FIELDS) : false;
  const update = (field: Exclude<keyof SignupInput, "country_code">) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  return (
    <AuthFrame
      title="Create workspace"
      subtitle="Set up TravelMind for your agency. You'll be the workspace owner and can invite your team next."
      footer={
        <>
          Already have a workspace?{" "}
          <Link to="/login" className={AUTH_LINK}>
            Sign in
          </Link>
        </>
      }
    >
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
          hint={PASSWORD_RULE}
          value={form.password}
          onChange={update("password")}
          error={fieldErrors.password}
        />
        <SelectField
          label="Country"
          hint="Sets your currency and time zone."
          value={form.country_code}
          onChange={(event) =>
            setForm((current) => ({ ...current, country_code: event.target.value as SignupCountryCode }))
          }
          error={fieldErrors.country_code}
        >
          {SIGNUP_COUNTRIES.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
        </SelectField>
        {error && showGeneralError && <FormError error={error} />}
        <Button type="submit" loading={signup.isPending} className="mt-1 w-full">
          Create workspace
        </Button>
      </form>
    </AuthFrame>
  );
}
