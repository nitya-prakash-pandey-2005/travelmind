import { apiFetch } from "./client";
import type { Invitation, InvitationCreated, TeamMember } from "./types";

export const teamApi = {
  listTeam: () => apiFetch<TeamMember[]>("/api/v1/team"),
  listInvitations: () => apiFetch<Invitation[]>("/api/v1/invitations"),
  createInvitation: (body: { email: string; role: "admin" | "agent" }) =>
    apiFetch<InvitationCreated>("/api/v1/invitations", { method: "POST", body }),
};
