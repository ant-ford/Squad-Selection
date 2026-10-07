/**
 * The officers' person search, person page and change history (Supabase
 * backend; the "people" section: Membership Officer, Men's Convenor,
 * Section Captains). Reads only: the saves live beside this, each one SQL
 * function that writes its own activity_log row.
 */
import type { Env } from "../env";
import { sectionsFor, type AuthorizedUser } from "../auth";
import { HttpError } from "../http";
import { db, eq } from "../data/supabase";
import { PIPELINE_STAGES, ACCEPTED_STAGE, stageTargets } from "../../../shared/membershipStages";
import { actionLabel, type HistoryEntry } from "../../../shared/history";
import { ACTIVITY_SELECT, activityEntry, coachesPerson, HISTORY_ROWS, isOfficer, iso, newestFirst, personHockeyHistory, type ActivityRowDb } from "../history";
import { displayName, type PersonAdminCan, type PersonAdminView, type PersonSearchRow } from "../../../shared/adminPeople";

/** A People api id as the app holds it. */
export const API_ID = /^[A-Za-z0-9-]{3,64}$/;

/** Letters (any script), spaces and the punctuation names carry; nothing PostgREST treats as syntax. */
const SEARCH = /^[\p{L}\p{M} '’.-]+$/u;
const MAX_RESULTS = 20;

interface NameCols {
  preferred_name: string | null;
  given_names: string | null;
  surname: string | null;
}

interface SearchRowDb extends NameCols {
  api_id: string;
  registered_team: string | null;
  status: string | null;
  applicant_stage: string | null;
  active: boolean;
}

const blank = (v: string | null | undefined) => (v == null || v === "" ? null : v);

/**
 * Name search: every word must start-or-contain-match a preferred, given or
 * surname (case-insensitive). At most 20, by surname.
 */
export async function searchPeople(env: Env, q: string): Promise<PersonSearchRow[]> {
  const words = q.trim().split(/\s+/).filter(Boolean).slice(0, 4);
  if (words.length === 0) return [];
  if (q.length > 60 || !words.every((w) => SEARCH.test(w))) {
    throw new HttpError("Search by name: letters, spaces, hyphens and apostrophes only.", 400, "INVALID_INPUT");
  }
  // Each word quoted, so its apostrophes and dots are plain characters; the
  // pattern can't hold PostgREST's wildcard or separators (SEARCH above).
  const word = (w: string) => {
    const v = `"*${w}*"`;
    return `or(preferred_name.ilike.${v},given_names.ilike.${v},surname.ilike.${v})`;
  };
  const filter = encodeURIComponent(`(${words.map(word).join(",")})`);
  const rows = await db(env).select<SearchRowDb>(
    "people",
    `select=api_id,preferred_name,given_names,surname,registered_team,status,applicant_stage,active&and=${filter}&order=surname,preferred_name&limit=${MAX_RESULTS}`,
  );
  return rows.slice(0, MAX_RESULTS).map((p) => ({
    id: p.api_id,
    name: displayName(p),
    team: blank(p.registered_team),
    status: blank(p.status),
    stage: blank(p.applicant_stage),
    active: p.active === true,
  }));
}

interface PersonDb extends SearchRowDb {
  member_type: string | null;
  category_type: string | null;
  membership_no: string | null;
  join_date: string | null;
  commitment_end_date: string | null;
  selected_team_sos: string | null;
  selected_team_eos: string | null;
  playing_position: string | null;
}

export const PERSON_COLUMNS =
  "api_id,preferred_name,given_names,surname,registered_team,status,applicant_stage,active,member_type,category_type,membership_no,join_date,commitment_end_date,selected_team_sos,selected_team_eos,playing_position";

/** Child members and both Junior categories, with no application under way. */
export function isJuniorMember(p: Pick<PersonDb, "status" | "applicant_stage" | "member_type" | "category_type">): boolean {
  const inPipeline = (PIPELINE_STAGES as readonly string[]).includes(p.applicant_stage ?? "") && p.applicant_stage !== ACCEPTED_STAGE;
  return p.status === "Member" && !inPipeline && (p.member_type === "Child" || (p.category_type ?? "").startsWith("Junior"));
}

/**
 * What the caller may do to this person (owner decisions, 6 Oct 2026):
 *  - membership details and stage moves: the membership section (Membership
 *    Officer, Section Captains);
 *  - selected teams and position: Section Captains (club); the registered
 *    team: the Men's Convenor (registration);
 *  - manual suspensions: the Men's Convenor office only;
 *  - make active or inactive: Section Captains only (the office, or the
 *    Teams Section Captain link that auth.ts reads as isSectionCaptain);
 *  - the junior route: a Section Captain or the Membership Officer, for a
 *    junior member.
 */
export function canFor(user: AuthorizedUser, p: PersonDb): PersonAdminCan {
  const sections = sectionsFor(user);
  const offices = new Set(user.officerRoles.map((r) => r.office));
  const membership = sections.includes("membership");
  const registeredTeam = sections.includes("registration");
  return {
    membership,
    stage: membership && stageTargets(p.status, p.applicant_stage).length > 0,
    squad: sections.includes("club") || registeredTeam,
    registeredTeam,
    suspend: offices.has("hockeyConvenor"),
    activate: offices.has("sectionCaptain") || user.isSectionCaptain,
    juniorRoute: membership && isJuniorMember(p),
  };
}

export async function readPerson(env: Env, id: string): Promise<PersonDb> {
  if (!API_ID.test(id)) throw new HttpError("Person not found.", 404, "NOT_FOUND");
  const p = await db(env).one<PersonDb>("people", `select=${PERSON_COLUMNS}&api_id=${eq(id)}`);
  if (!p) throw new HttpError("Person not found.", 404, "NOT_FOUND");
  return p;
}

export async function getPersonAdmin(env: Env, user: AuthorizedUser, id: string): Promise<PersonAdminView> {
  const p = await readPerson(env, id);
  const can = canFor(user, p);
  const view: PersonAdminView = {
    id: p.api_id,
    name: displayName(p),
    status: blank(p.status),
    stage: blank(p.applicant_stage),
    active: p.active === true,
    team: blank(p.registered_team),
    can,
  };
  if (can.membership) {
    view.membership = {
      memberType: blank(p.member_type),
      categoryType: blank(p.category_type),
      membershipNo: blank(p.membership_no),
      joinDate: blank(p.join_date),
      commitmentEndDate: blank(p.commitment_end_date),
    };
  }
  if (can.stage) view.stageTargets = stageTargets(p.status, p.applicant_stage);
  if (can.squad) {
    view.squad = {
      registeredTeam: blank(p.registered_team),
      selectedTeamSos: blank(p.selected_team_sos),
      selectedTeamEos: blank(p.selected_team_eos),
      playingPosition: blank(p.playing_position),
    };
    const teams = await db(env).select<{ team_name: string }>("teams", "select=id,team_name&active=is.true&order=team_rank.nullslast,team_name");
    view.teamOptions = teams.map((t) => t.team_name);
  }
  return view;
}

// ── History ──────────────────────────────────────────────────────────────

export type { ActivityRowDb } from "../history";

export interface RankingRowDb {
  occurred_at: string;
  kind: string;
  actor: NameCols | null;
}

/**
 * The log, the active/inactive ranking events and (when given) the squad
 * and answer entries as one list, newest first, at most 50. `forCoach`
 * leaves out what a coach mustn't see: officers' actions and personal fields.
 */
export function buildHistory(
  activity: ActivityRowDb[],
  ranking: RankingRowDb[],
  more: HistoryEntry[] = [],
  forCoach = false,
): HistoryEntry[] {
  return newestFirst([
    ...activity.map((r) => activityEntry(r, { forCoach })).filter((e): e is HistoryEntry => e !== null),
    ...ranking.map((r) => ({
      at: iso(r.occurred_at),
      actor: r.actor ? displayName(r.actor) : null,
      action: r.kind,
      summary: actionLabel(r.kind),
      fields: [],
    })),
    ...more,
  ]);
}

/**
 * GET /api/history?person=<api id>. Officers with the people section see it
 * all; the coaches of the person's team see the hockey side of it (history.ts).
 * Reads: the person, then their log, ranking events, squad changes and
 * answers given for them, then the fixtures of those answers.
 */
export async function getPersonHistory(
  env: Env,
  personApiId: string,
  viewer?: Pick<AuthorizedUser, "officerRoles" | "coachTeams">,
): Promise<{ entries: HistoryEntry[] }> {
  if (!API_ID.test(personApiId)) throw new HttpError("Choose a person.", 400, "INVALID_INPUT");
  const d = db(env);
  const person = await d.one<{ id: string; registered_team: string | null; selected_team_sos: string | null; selected_team_eos: string | null }>(
    "people",
    `select=id,registered_team,selected_team_sos,selected_team_eos&api_id=${eq(personApiId)}`,
  );
  if (!person) throw new HttpError("Person not found.", 404, "NOT_FOUND");
  const forCoach = !!viewer && !isOfficer(viewer);
  if (forCoach && !coachesPerson(viewer, person)) {
    throw new HttpError("Only officers and this player's coaches can see their history.", 403, "COACH_ACCESS_REQUIRED");
  }
  const actor = "actor:people!{fk}(preferred_name,given_names,surname)";
  const [activity, ranking, hockey] = await Promise.all([
    d.select<ActivityRowDb>(
      "activity_log",
      `select=${ACTIVITY_SELECT}&entity=eq.people&entity_id=${eq(person.id)}&order=occurred_at.desc&limit=${HISTORY_ROWS}`,
    ),
    d.select<RankingRowDb>(
      "ranking_events",
      `select=id,occurred_at,kind,${actor.replace("{fk}", "ranking_events_actor_id_fkey")}&person_id=${eq(person.id)}&kind=in.(activate,deactivate)&order=occurred_at.desc&limit=${HISTORY_ROWS}`,
    ),
    personHockeyHistory(env, person.id),
  ]);
  return { entries: buildHistory(activity, ranking, hockey, forCoach) };
}
