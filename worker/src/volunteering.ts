/**
 * Volunteering: each person's roles and coaching and
 * umpiring levels, which they can change any time, and the Volunteers view
 * for every officer (sponsors and the Men's Convenor included), coach and
 * team captain. See shared/volunteering.ts.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { HttpError } from "./http";
import { db, eq, SupabaseError } from "./data/supabase";
import { canSeeVolunteers } from "./volunteerAccess";
import { invalidatePeople } from "./invalidation";
import { fullName } from "../../shared/personName";
import {
  COACH_LEVELS,
  EMPTY_ROLES,
  NO_QUALIFICATION,
  UMPIRE_LEVELS,
  VOLUNTEER_GROUPS,
  type MyVolunteering,
  type VolunteerRoles,
  type VolunteersBoard,
  type VolunteeringAnswers,
} from "../../shared/volunteering";

interface PersonRow {
  id: string;
  api_id: string;
  preferred_name: string | null;
  given_names: string | null;
  surname: string | null;
  status: string | null;
  active: boolean | null;
  email: string | null;
  registered_team: string | null;
  selected_team_sos: string | null;
  selected_team_eos: string | null;
  qualified_coach: string | null;
  qualified_umpire: string | null;
  volunteering_updated_at: string | null;
  [column: string]: unknown;
}

const COLUMNS = [
  "id,api_id,preferred_name,given_names,surname,status,active,email,registered_team,selected_team_sos,selected_team_eos",
  "qualified_coach,qualified_umpire,volunteering_updated_at",
  ...VOLUNTEER_GROUPS.map((g) => g.column),
].join(",");

/** The roles in a person's row that the form offers ("Not Interested" and retired choices left out). */
export function rolesOf(row: Record<string, unknown>): VolunteerRoles {
  const roles = { ...EMPTY_ROLES };
  for (const g of VOLUNTEER_GROUPS) {
    const v = Array.isArray(row[g.column]) ? (row[g.column] as string[]) : [];
    roles[g.key] = g.options.filter((o) => v.includes(o));
  }
  return roles;
}

const level = (v: string | null) => (v && v !== NO_QUALIFICATION ? v : null);

/**
 * "Nothing for now" is an answer with no roles: saved in Eddy with none
 * ticked, or every group answered on the Airtable form with none of the
 * roles the form still offers.
 */
function nothingForNow(row: PersonRow, roles: VolunteerRoles): boolean {
  if (Object.values(roles).some((r) => r.length > 0)) return false;
  if (row.volunteering_updated_at) return true;
  return VOLUNTEER_GROUPS.every((g) => Array.isArray(row[g.column]) && (row[g.column] as string[]).length > 0);
}

export async function getMyVolunteering(env: Env, user: AuthorizedUser): Promise<MyVolunteering> {
  const row = await db(env).one<PersonRow>("people", `select=${COLUMNS}&api_id=${eq(user.personId)}`);
  if (!row) throw new HttpError("Your People record was not found.", 404, "NOT_FOUND");
  const roles = rolesOf(row);
  return {
    roles,
    nothingForNow: nothingForNow(row, roles),
    qualifiedCoach: level(row.qualified_coach),
    qualifiedUmpire: level(row.qualified_umpire),
    updatedAt: row.volunteering_updated_at,
  };
}

/** Validates the answers from a form: only offered roles and known levels. */
export function parseVolunteering(body: Record<string, unknown>): VolunteeringAnswers {
  const given = (body.roles ?? {}) as Record<string, unknown>;
  const roles = { ...EMPTY_ROLES };
  for (const g of VOLUNTEER_GROUPS) {
    const v = given[g.key];
    if (v !== undefined && !Array.isArray(v)) throw new HttpError(`${g.label}: choose from the list.`, 400, "INVALID_INPUT");
    const picked = (v ?? []) as unknown[];
    if (picked.some((x) => typeof x !== "string" || !g.options.includes(x))) throw new HttpError(`${g.label}: choose from the list.`, 400, "INVALID_INPUT");
    roles[g.key] = g.options.filter((o) => picked.includes(o));
  }
  const pick = (v: unknown, allowed: readonly string[], what: string) => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v !== "string" || !allowed.includes(v)) throw new HttpError(`Choose a ${what} level from the list.`, 400, "INVALID_INPUT");
    return v;
  };
  const answers: VolunteeringAnswers = {
    roles,
    nothingForNow: body.nothingForNow === true,
    qualifiedCoach: pick(body.qualifiedCoach, COACH_LEVELS, "coaching"),
    qualifiedUmpire: pick(body.qualifiedUmpire, UMPIRE_LEVELS, "umpiring"),
  };
  const any = Object.values(roles).some((r) => r.length > 0);
  if (any && answers.nothingForNow) throw new HttpError("Untick “Nothing for now”, or the roles.", 400, "INVALID_INPUT");
  if (!any && !answers.nothingForNow) throw new HttpError("Tick anything you'd help with, or “Nothing for now”.", 400, "INVALID_INPUT");
  return answers;
}

/** Saves the person's own volunteering; answers the form no longer offers are kept. */
export async function saveVolunteering(env: Env, user: AuthorizedUser, body: Record<string, unknown>) {
  const a = parseVolunteering(body);
  try {
    await db(env).rpc("save_volunteering", {
      p_actor: user.personId,
      p: {
        roles: a.roles,
        offered: Object.fromEntries(VOLUNTEER_GROUPS.map((g) => [g.key, g.options])),
        qualifiedCoach: a.qualifiedCoach,
        qualifiedUmpire: a.qualifiedUmpire,
      },
    });
  } catch (err) {
    if (err instanceof SupabaseError && err.code === "P0002") throw new HttpError("Your People record was not found.", 404, "NOT_FOUND");
    throw err;
  }
  // The chairman's email lists group people by these answers.
  await invalidatePeople(env);
  return { ok: true };
}

const personTeam = (p: PersonRow) => p.selected_team_eos || p.selected_team_sos || p.registered_team || "";

/** Everyone who offered a role, or holds a coaching or umpiring level. */
export async function getVolunteersBoard(env: Env, user: AuthorizedUser): Promise<VolunteersBoard> {
  if (!(await canSeeVolunteers(env, user))) {
    throw new HttpError("The volunteers list is for officers, coaches and captains.", 403, "OFFICER_ACCESS_REQUIRED");
  }
  const rows = await db(env).select<PersonRow>("people", `select=${COLUMNS}&status=in.(Member,Applicant)`);
  const volunteers = rows
    .map((r) => ({
      id: r.api_id,
      name: fullName(r),
      team: personTeam(r),
      status: r.status ?? "",
      active: r.active === true,
      email: r.email,
      roles: rolesOf(r),
      qualifiedCoach: level(r.qualified_coach),
      qualifiedUmpire: level(r.qualified_umpire),
      updatedAt: r.volunteering_updated_at,
    }))
    .filter((v) => v.qualifiedCoach || v.qualifiedUmpire || Object.values(v.roles).some((x) => x.length > 0))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { volunteers };
}
