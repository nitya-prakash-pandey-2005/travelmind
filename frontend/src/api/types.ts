export type Role = "owner" | "admin" | "agent";

export type User = { id: string; email: string; full_name: string; role: Role };
export type Agency = { id: string; name: string };
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
