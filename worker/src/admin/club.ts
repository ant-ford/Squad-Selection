/**
 * Offices and teams (Supabase backend; the "club" section: Section Captains,
 * who manage every office, sponsors included - owner, 6 Oct 2026):
 *
 *   GET  /api/admin/offices         every office row, Active first
 *   POST /api/admin/offices         a new holder (optionally handing one over;
 *                                   the Membership Officer and Chairman must:
 *                                   one holder at a time, 409 ONE_HOLDER)
 *   POST /api/admin/offices/:id     designation, office email, Active/Retired
 *   POST /api/admin/people          add an office holder who isn't in People
 *   GET  /api/admin/teams           coaches, captains, target size, Section Captain links
 *   POST /api/admin/teams/:id       coaches, captains, target squad size
 *
 * Each save is one SQL function (supabase/migrations/*_offices_teams_admin.sql)
 * that writes its own activity_log rows. Social secretaries stay in Events.
 */
import type { Env } from "../env";
import type { AuthorizedUser } from "../auth";
import type { Office } from "../data/officers";
import { HttpError } from "../http";
import { db } from "../data/supabase";
import { invalidateOffices, invalidatePeople, invalidateTeams } from "../invalidation";
import { normalizeEmail } from "../../../shared/normalizeEmail";
import { displayName } from "../../../shared/adminPeople";
import { adminRpc } from "./rpc";
import { API_ID } from "./people";

/** The app's office keys and the database's roles, in the order the screen lists them. */
export const OFFICE_ROLES: Record<Office, string> = {
  sectionCaptain: "section_captain",
  sectionChair: "section_chair",
  membershipOfficer: "membership_officer",
  hockeyConvenor: "hockey_convenor",
  kitConvenor: "kit_convenor",
  assistantDirector: "assistant_director",
  umpireCoordinator: "umpire_coordinator",
  sponsor: "sponsor",
};
const OFFICE_BY_ROLE = Object.fromEntries(Object.entries(OFFICE_ROLES).map(([k, v]) => [v, k as Office]));
const ROLE_ORDER = Object.values(OFFICE_ROLES);

const MESSAGES = {
  ALREADY_HOLDS: "They already hold this office.",
  ONE_HOLDER: "This office has one holder at a time. Choose who they take over from.",
  LAST_SECTION_CAPTAIN: "There must always be a Section Captain. Add the new one first.",
  EMAIL_TAKEN: "Someone already has this email. Find them by name instead.",
  NOT_FOUND: "Not found. Reload and try again.",
  TAKEN: "Someone is listed twice.",
};

const EMAIL = /^[^\s@"<>,;]+@[^\s@"<>,;]+\.[^\s@"<>,;]+$/;

interface Holder {
  id: string;
  name: string;
}

export interface OfficeView {
  id: string;
  office: Office;
  designation: string | null;
  officeEmail: string | null;
  status: "Active" | "Retired";
  holder: Holder | null;
}

interface OfficeDb {
  api_id: string;
  role: string;
  designation: string | null;
  office_email: string | null;
  status: "Active" | "Retired";
  person: { api_id: string; preferred_name: string | null; given_names: string | null; surname: string | null } | null;
}

const holder = (p: OfficeDb["person"]): Holder | null => (p ? { id: p.api_id, name: displayName(p) } : null);

export async function listOffices(env: Env): Promise<{ offices: OfficeView[] }> {
  const rows = await db(env).select<OfficeDb>(
    "offices",
    `select=id,api_id,role,designation,office_email,status,person:people!offices_person_id_fkey(api_id,preferred_name,given_names,surname)&role=in.(${ROLE_ORDER.join(",")})`,
  );
  const offices = rows.map((r) => ({
    id: r.api_id,
    office: OFFICE_BY_ROLE[r.role],
    designation: r.designation || null,
    officeEmail: r.office_email || null,
    status: r.status,
    holder: holder(r.person),
  }));
  offices.sort(
    (a, b) =>
      ROLE_ORDER.indexOf(OFFICE_ROLES[a.office]) - ROLE_ORDER.indexOf(OFFICE_ROLES[b.office]) ||
      (a.status === b.status ? 0 : a.status === "Active" ? -1 : 1) ||
      (a.holder?.name ?? "").localeCompare(b.holder?.name ?? ""),
  );
  return { offices };
}

function optionalText(body: Record<string, unknown>, key: string, label: string, max: number): string | null | undefined {
  if (!(key in body)) return undefined;
  const v = body[key];
  if (v !== null && typeof v !== "string") throw new HttpError(`${label} must be text.`, 400, "INVALID_INPUT");
  const t = (v ?? "").trim();
  if (t.length > max) throw new HttpError(`${label}: at most ${max} characters.`, 400, "INVALID_INPUT");
  return t || null;
}

function optionalEmail(body: Record<string, unknown>, key: string): string | null | undefined {
  const v = optionalText(body, key, "Office email", 200);
  if (v && !EMAIL.test(v)) throw new HttpError("Office email doesn't look like an email address.", 400, "INVALID_INPUT");
  return v == null ? v : normalizeEmail(v);
}

function apiId(v: unknown, what: string): string {
  if (typeof v !== "string" || !API_ID.test(v)) throw new HttpError(`Choose ${what}.`, 400, "INVALID_INPUT");
  return v;
}

/** Validates a new office holder; the role is the database's. */
export function parseNewOffice(body: Record<string, unknown>): Record<string, unknown> {
  const office = body.office as Office;
  if (typeof office !== "string" || !(office in OFFICE_ROLES)) throw new HttpError("Choose an office.", 400, "INVALID_INPUT");
  const p: Record<string, unknown> = { role: OFFICE_ROLES[office], person: apiId(body.personId, "who holds it") };
  const designation = optionalText(body, "designation", "Designation", 80);
  const officeEmail = optionalEmail(body, "officeEmail");
  if (designation) p.designation = designation;
  if (officeEmail) p.officeEmail = officeEmail;
  if (body.replaces != null) p.replaces = apiId(body.replaces, "whose office this takes over");
  return p;
}

/** Validates an edit to one office row. */
export function parseOfficeEdit(id: string, body: Record<string, unknown>): Record<string, unknown> {
  const p: Record<string, unknown> = { id };
  const designation = optionalText(body, "designation", "Designation", 80);
  const officeEmail = optionalEmail(body, "officeEmail");
  if (designation !== undefined) p.designation = designation ?? "";
  if (officeEmail !== undefined) p.officeEmail = officeEmail ?? "";
  if ("status" in body) {
    if (body.status !== "Active" && body.status !== "Retired") throw new HttpError("Status must be Active or Retired.", 400, "INVALID_INPUT");
    p.status = body.status;
  }
  if (Object.keys(p).length === 1) throw new HttpError("Nothing to save.", 400, "INVALID_INPUT");
  return p;
}

export async function addOffice(env: Env, actor: AuthorizedUser, body: Record<string, unknown>): Promise<{ ok: true; id: string }> {
  const p = parseNewOffice(body);
  const result = await adminRpc<{ id: string }>(env, "admin_save_office", { p, p_actor: actor.personId }, { messages: MESSAGES });
  await invalidateOffices(env);
  return { ok: true, id: result.id };
}

export async function editOffice(env: Env, actor: AuthorizedUser, id: string, body: Record<string, unknown>): Promise<{ ok: true; id: string }> {
  const p = parseOfficeEdit(apiId(id, "an office"), body);
  const result = await adminRpc<{ id: string }>(env, "admin_save_office", { p, p_actor: actor.personId }, { messages: MESSAGES });
  await invalidateOffices(env);
  return { ok: true, id: result.id };
}

/** Someone who holds (or is about to hold) an office but isn't in People. Not Active. */
export async function createOfficeHolder(env: Env, actor: AuthorizedUser, body: Record<string, unknown>): Promise<{ ok: true; id: string }> {
  const surname = optionalText(body, "surname", "Surname", 60);
  const email = optionalText(body, "email", "Email", 200);
  if (!surname) throw new HttpError("Enter their surname.", 400, "INVALID_INPUT");
  if (!email || !EMAIL.test(email)) throw new HttpError("Enter their email address.", 400, "INVALID_INPUT");
  const p = {
    preferredName: optionalText(body, "preferredName", "Preferred name", 60) ?? null,
    givenNames: optionalText(body, "givenNames", "Given names", 80) ?? null,
    surname,
    email: normalizeEmail(email),
  };
  const result = await adminRpc<{ id: string }>(env, "admin_create_person", { p, p_actor: actor.personId }, { messages: MESSAGES });
  // A sign-in lookup may have cached "no such person" for this email.
  await invalidatePeople(env);
  return { ok: true, id: result.id };
}

// ── Teams ────────────────────────────────────────────────────────────────

export interface TeamAdminView {
  id: string;
  name: string;
  rank: number | null;
  active: boolean;
  targetSquadSize: number | null;
  coaches: Holder[];
  captains: Holder[];
  /** Read-only: these links give coach rights on every team (auth.ts). */
  sectionCaptains: Holder[];
}

interface TeamDb {
  api_id: string;
  team_name: string;
  team_rank: number | null;
  active: boolean;
  target_squad_size: number | null;
  team_people: { role: string; ordinal: number; person: OfficeDb["person"] }[];
}

export async function listTeams(env: Env): Promise<{ teams: TeamAdminView[] }> {
  const rows = await db(env).select<TeamDb>(
    "teams",
    "select=id,api_id,team_name,team_rank,active,target_squad_size,team_people(role,ordinal,person:people(api_id,preferred_name,given_names,surname))&order=team_rank.nullslast,team_name",
  );
  const people = (t: TeamDb, role: string) =>
    t.team_people
      .filter((tp) => tp.role === role && tp.person)
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((tp) => holder(tp.person)!);
  return {
    teams: rows.map((t) => ({
      id: t.api_id,
      name: t.team_name,
      rank: t.team_rank,
      active: t.active,
      targetSquadSize: t.target_squad_size,
      coaches: people(t, "coach"),
      captains: people(t, "team_captain"),
      sectionCaptains: people(t, "section_captain"),
    })),
  };
}

const MAX_PEOPLE = 20;

function idList(v: unknown, label: string): string[] {
  if (!Array.isArray(v) || v.length > MAX_PEOPLE || !v.every((id) => typeof id === "string" && API_ID.test(id))) {
    throw new HttpError(`${label}: choose up to ${MAX_PEOPLE} people.`, 400, "INVALID_INPUT");
  }
  return [...new Set(v as string[])];
}

/** Validates a team save; the keys are admin_save_team's. */
export function parseTeamChange(body: Record<string, unknown>): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if ("coachIds" in body) p.coaches = idList(body.coachIds, "Coaches");
  if ("captainIds" in body) p.captains = idList(body.captainIds, "Captains");
  if ("targetSquadSize" in body) {
    const n = body.targetSquadSize;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 40) {
      throw new HttpError("Target squad size must be a whole number from 1 to 40.", 400, "INVALID_INPUT");
    }
    p.targetSquadSize = n;
  }
  if (Object.keys(p).length === 0) throw new HttpError("Nothing to save.", 400, "INVALID_INPUT");
  return p;
}

export async function saveTeam(env: Env, actor: AuthorizedUser, id: string, body: Record<string, unknown>): Promise<{ ok: true; changed: string[] }> {
  const team = apiId(id, "a team");
  const p = parseTeamChange(body);
  const result = await adminRpc<{ changed: string[] }>(env, "admin_save_team", { p_team: team, p_actor: actor.personId, p }, { messages: MESSAGES });
  if (result.changed.length > 0) await invalidateTeams(env);
  return { ok: true, changed: result.changed };
}
