/**
 * POST /api/admin/people/:id/squad: teams and position on the person page
 * (Supabase backend; owner rules, 6 Oct 2026):
 *
 *  - registered team: the Men's Convenor only (the "registration" section);
 *  - selected team at the start and end of season, and playing position:
 *    Section Captains (the "club" section) and the Men's Convenor.
 *
 * Body: {registeredTeam?, selectedTeamSos?, selectedTeamEos?,
 * playingPosition?, expect}; `expect` holds what the screen read for each
 * field sent, and a field someone changed since answers 409 CHANGED.
 * Teams must be active teams; positions come from shared/profile.ts.
 *
 * Goes through admin_update_person: the update and its activity_log row
 * (field names only) in one transaction.
 *
 * Changing the registered team does nothing else by itself: no
 * registration_events row and no re-registration. Afterwards only play-ups
 * from the new team count towards an automatic move up, and the HKHA
 * registration screen lists the player again until he is ticked off for the
 * new team.
 */
import type { Env } from "../env";
import { sectionsFor, type AuthorizedUser } from "../auth";
import { HttpError } from "../http";
import { db } from "../data/supabase";
import { invalidatePeople } from "../invalidation";
import { PLAYING_POSITIONS } from "../../../shared/profile";
import { adminRpc } from "./rpc";
import { readPerson } from "./people";

/** The body's names and the People columns behind them. */
export const SQUAD_FIELDS = {
  registeredTeam: "registered_team",
  selectedTeamSos: "selected_team_sos",
  selectedTeamEos: "selected_team_eos",
  playingPosition: "playing_position",
} as const;
export type SquadKey = keyof typeof SQUAD_FIELDS;

const LABELS: Record<SquadKey, string> = {
  registeredTeam: "Registered team",
  selectedTeamSos: "Selected team (start of season)",
  selectedTeamEos: "Selected team (end of season)",
  playingPosition: "Position",
};

const TEAM_KEYS: readonly SquadKey[] = ["registeredTeam", "selectedTeamSos", "selectedTeamEos"];

export const SQUAD_CHANGED = "Someone else changed this while you had it open. Reload and try again.";

export interface SquadChange {
  /** Column -> new value (null clears). */
  patch: Record<string, string | null>;
  /** Column -> the value the screen read. */
  expect: Record<string, string | null>;
  /** The teams the patch names, to check against the active teams. */
  teams: string[];
}

/**
 * Validates a squad save and checks the caller may change every field it
 * sends. Throws 400 for bad input and 403 for a field outside their rights.
 */
export function parseSquadChange(body: Record<string, unknown>, may: { registeredTeam: boolean; squad: boolean }): SquadChange {
  const expectIn = body.expect;
  if (!expectIn || typeof expectIn !== "object" || Array.isArray(expectIn)) {
    throw new HttpError("Reload the page and try again.", 400, "INVALID_INPUT");
  }
  const patch: Record<string, string | null> = {};
  const expect: Record<string, string | null> = {};
  const teams: string[] = [];
  for (const key of Object.keys(SQUAD_FIELDS) as SquadKey[]) {
    if (!(key in body)) continue;
    const allowed = key === "registeredTeam" ? may.registeredTeam : may.squad;
    if (!allowed) {
      throw new HttpError(
        key === "registeredTeam" ? "Only the Men's Convenor can change the registered team." : "You can't change this.",
        403,
        "FORBIDDEN",
      );
    }
    const raw = body[key];
    if (raw !== null && typeof raw !== "string") throw new HttpError(`${LABELS[key]} must be text.`, 400, "INVALID_INPUT");
    const value = (raw ?? "").trim() || null;
    if (value !== null) {
      if (key === "playingPosition" && !(PLAYING_POSITIONS as readonly string[]).includes(value)) {
        throw new HttpError("Choose a position from the list.", 400, "INVALID_INPUT");
      }
      if (TEAM_KEYS.includes(key)) {
        if (value.length > 60) throw new HttpError("Choose one of the club's teams.", 400, "INVALID_INPUT");
        teams.push(value);
      }
    }
    const was = (expectIn as Record<string, unknown>)[key];
    if (!(key in expectIn) || (was !== null && typeof was !== "string")) {
      throw new HttpError("Reload the page and try again.", 400, "INVALID_INPUT");
    }
    patch[SQUAD_FIELDS[key]] = value;
    expect[SQUAD_FIELDS[key]] = was ?? null;
  }
  if (Object.keys(patch).length === 0) throw new HttpError("Nothing to save.", 400, "INVALID_INPUT");
  return { patch, expect, teams };
}

/** Whose rights cover which fields: the same rule the person page's `can` flags show. */
export function squadRights(user: AuthorizedUser): { registeredTeam: boolean; squad: boolean } {
  const sections = sectionsFor(user);
  const registeredTeam = sections.includes("registration");
  return { registeredTeam, squad: registeredTeam || sections.includes("club") };
}

export async function saveSquad(
  env: Env,
  actor: AuthorizedUser,
  personId: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; changed: string[] }> {
  const may = squadRights(actor);
  if (!may.squad) throw new HttpError("You can't change this.", 403, "FORBIDDEN");
  const change = parseSquadChange(body, may);
  const p = await readPerson(env, personId);

  if (change.teams.length > 0) {
    const active = await db(env).select<{ team_name: string }>("teams", "select=team_name&active=is.true");
    const names = new Set(active.map((t) => t.team_name));
    if (!change.teams.every((t) => names.has(t))) throw new HttpError("Choose one of the club's teams.", 400, "INVALID_INPUT");
  }

  const result = await adminRpc<{ status: "ok"; changed: string[] }>(
    env,
    "admin_update_person",
    { p_person: p.api_id, p_actor: actor.personId, p_action: "admin-squad", p_patch: change.patch, p_expect: change.expect },
    { messages: { CHANGED: SQUAD_CHANGED, NOT_FOUND: "Person not found." } },
  );
  // Eligibility, ranking and the boards read these columns.
  if (result.changed.length > 0) await invalidatePeople(env);
  return { ok: true, changed: result.changed };
}
