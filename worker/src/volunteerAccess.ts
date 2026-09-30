/**
 * Who may see the Volunteers view: every officer (sponsors and the Hockey
 * Convenor included), coach and team captain (owner decision, 2026-10-01).
 * Its own module so the profile can ask without loading the rest of
 * volunteering.ts.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { backendFor } from "./data/backend";
import { db } from "./data/supabase";
import { getCached } from "./cache";
import { getReferenceData } from "./reference";

/** People ids holding any Active office, sponsors and the Hockey Convenor included. */
async function officeHolders(env: Env): Promise<Set<string>> {
  const { data } = await getCached(
    "volunteering:office-holders",
    async () =>
      (await db(env).select<{ member: string | null }>("api_offices", "select=id,member&status=eq.Active"))
        .map((r) => r.member)
        .filter((m): m is string => !!m),
    60 * 1000,
  );
  return new Set(data);
}

/** Every officer, coach and team captain (owner decision, 2026-10-01). Supabase backend only. */
export async function canSeeVolunteers(env: Env, user: AuthorizedUser): Promise<boolean> {
  if (backendFor(env, "people") !== "supabase") return false;
  if (user.role === "coach" || user.officerRoles.length > 0) return true;
  const ref = await getReferenceData(env);
  if (ref.teams.some((t) => (t.teamCaptain || []).includes(user.personId))) return true;
  return (await officeHolders(env)).has(user.personId);
}
