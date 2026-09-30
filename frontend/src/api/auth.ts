import { ApiError, apiFetch } from "./client";
import type { Me } from "./types";

export type LoginInput = { email: string; password: string };
/** Countries an agency can sign up from; the country sets its currency and time zone. */
export const SIGNUP_COUNTRIES = [
  { code: "IN", name: "India" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
  { code: "SG", name: "Singapore" },
] as const;
export type SignupCountryCode = (typeof SIGNUP_COUNTRIES)[number]["code"];

export type SignupInput = {
  agency_name: string;
  full_name: string;
  email: string;
  password: string;
  country_code: SignupCountryCode;
};
export type AcceptInvitationInput = { token: string; full_name: string; password: string };

export const authApi = {
  async me(): Promise<Me | null> {
    try {
      return await apiFetch<Me>("/api/v1/auth/me");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  login: (body: LoginInput) => apiFetch<Me>("/api/v1/auth/login", { method: "POST", body }),
  signup: (body: SignupInput) => apiFetch<Me>("/api/v1/auth/signup", { method: "POST", body }),
  logout: () => apiFetch<void>("/api/v1/auth/logout", { method: "POST" }),
  /** Creates a private demo workspace and signs its presenter in (201), or 429 when rate limited. */
  startDemo: () => apiFetch<Me>("/api/v1/demo", { method: "POST" }),
  /** Leaves a demo workspace: ends the session exactly like logout. */
  exitDemo: () => apiFetch<void>("/api/v1/demo/exit", { method: "POST" }),
  acceptInvitation: (body: AcceptInvitationInput) =>
    apiFetch<Me>("/api/v1/invitations/accept", { method: "POST", body }),
};
