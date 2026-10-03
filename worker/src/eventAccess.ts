/**
 * Who keeps special events (events.ts): a team's social secretaries
 * (team_people role social_secretary) that team's events; the overall
 * Social Secretary (offices role social_secretary) and the Section
 * Captains any event. Kept apart from events.ts, like volunteerAccess.ts,
 * so the profile and dashboard can ask without loading the rest.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { backendFor } from "./data/backend";
import { db, eq } from "./data/supabase";
import { getCached } from "./cache";

export interface EventRights {
  /** Their People uuid; "" when there's no record. */
  personUuid: string;
  /** Section Captain or the overall Social Secretary. */
  club: boolean;
  /** The teams they're social secretary of. */
  teams: { id: string; name: string }[];
}

const RIGHTS_TTL_MS = 5 * 60 * 1000;

export async function eventRights(env: Env, user: AuthorizedUser): Promise<EventRights> {
  const { data } = await getCached(
    `event-rights:${user.personId}`,
    async (): Promise<EventRights> => {
      const d = db(env);
      const me = await d.one<{ id: string }>("people", `select=id&api_id=${eq(user.personId)}`);
      if (!me) return { personUuid: "", club: false, teams: [] };
      const [offices, teams] = await Promise.all([
        d.select<{ id: string }>("offices", `select=id&person_id=${eq(me.id)}&status=eq.Active&role=in.(section_captain,social_secretary)`),
        d.select<{ teams: { id: string; team_name: string } | null }>(
          "team_people",
          `select=teams(id,team_name)&person_id=${eq(me.id)}&role=eq.social_secretary`,
          "team_id,role,person_id",
        ),
      ]);
      return {
        personUuid: me.id,
        club: user.isSectionCaptain || offices.length > 0,
        teams: teams.flatMap((t) => (t.teams ? [{ id: t.teams.id, name: t.teams.team_name }] : [])),
      };
    },
    RIGHTS_TTL_MS,
  );
  return data;
}

export const managesEvent = (r: EventRights, e: { team_id: string | null }) => r.club || (!!e.team_id && r.teams.some((t) => t.id === e.team_id));

/** Whether the Events screen is theirs (the officers' menu). */
export async function canManageEvents(env: Env, user: AuthorizedUser): Promise<boolean> {
  if (backendFor(env, "people") !== "supabase") return false;
  try {
    const r = await eventRights(env, user);
    return r.club || r.teams.length > 0;
  } catch {
    return false;
  }
}
