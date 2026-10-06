/**
 * Who keeps special events (events.ts): a team's social secretaries
 * (team_people role social_secretary) that team's events; the overall
 * Social Secretary (offices role social_secretary) and the Section
 * Captains any event. Kept apart from events.ts, like volunteerAccess.ts,
 * so the profile and dashboard can ask without loading the rest.
 *
 * Everything here comes from what auth_context read with the person
 * (auth.ts): no reads of its own.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";

export interface EventRights {
  /** Their People uuid; "" when there's no record. */
  personUuid: string;
  /** Section Captain or the overall Social Secretary. */
  club: boolean;
  /** The teams they're social secretary of. */
  teams: { id: string; name: string }[];
}

export async function eventRights(_env: Env, user: AuthorizedUser): Promise<EventRights> {
  return {
    personUuid: user.personUuid,
    // A Teams.Section Captain link, or an Active Section Captain or Social
    // Secretary office.
    club: user.isSectionCaptain || user.offices.some((o) => o.role === "section_captain" || o.role === "social_secretary"),
    teams: user.socialSecretaryTeams,
  };
}

export const managesEvent = (r: EventRights, e: { team_id: string | null }) => r.club || (!!e.team_id && r.teams.some((t) => t.id === e.team_id));

/** Whether the Events screen is theirs (the officers' menu). */
export async function canManageEvents(env: Env, user: AuthorizedUser): Promise<boolean> {
  const r = await eventRights(env, user);
  return r.club || r.teams.length > 0;
}
