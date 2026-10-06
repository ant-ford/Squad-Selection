/**
 * Who may see the Volunteers view: every officer (sponsors and the Hockey
 * Convenor included), coach and team captain (owner decision, 2026-10-01).
 * Its own module so the profile can ask without loading the rest of
 * volunteering.ts. Decided from what auth_context read with the person
 * (auth.ts): no reads of its own.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";

/** Every officer, coach and team captain (owner decision, 2026-10-01). */
export async function canSeeVolunteers(_env: Env, user: AuthorizedUser): Promise<boolean> {
  return user.role === "coach" || user.officerRoles.length > 0 || user.captainTeams.length > 0 || user.offices.length > 0;
}
