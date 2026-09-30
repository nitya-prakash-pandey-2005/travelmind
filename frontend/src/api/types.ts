export type Role = "owner" | "admin" | "agent";

export type User = { id: string; email: string; full_name: string; role: Role };
export type Agency = {
  id: string;
  name: string;
  /** ISO 3166-1 alpha-2, e.g. "IN". */
  country_code: string;
  /** ISO 4217, e.g. "INR": every amount the agency sees is in this currency. */
  currency: string;
  /** IANA timezone, e.g. "Asia/Kolkata". */
  timezone: string;
  /** "#rrggbb"; tints accents only, never text. */
  brand_color: string;
  is_demo: boolean;
};
export type Me = { user: User; agency: Agency };

export type TeamMember = { id: string; email: string; full_name: string; role: Role };

export type Invitation = {
  id: string;
  email: string;
  role: Exclude<Role, "owner">;
  created_at: string;
  expires_at: string;
};
export type InvitationCreated = Invitation & { token: string };

export type Airport = {
  iata_code: string;
  name: string;
  city: string | null;
  country_code: string;
  country_name: string;
  latitude: number;
  longitude: number;
};
