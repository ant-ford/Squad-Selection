/**
 * Change history (GET /api/history): a person's or a match's, newest first.
 *
 *   ?person=<api id>  officers with the people section see everything; the
 *                     coaches of the person's team see what's about hockey
 *                     (teams, Active, Opt-In Only, squads, answers given for
 *                     them), never personal fields
 *   ?match=<api id>   officers with the people section, and the coaches of
 *                     either HKFC side: squad changes, fixture changes (kit,
 *                     time, venue, by whom or by HKHA) and answers coaches
 *                     gave for players
 *
 * Sources: activity_log (written by officers' functions, and by the audit
 * trigger of migration 20261007160004_change_history), match_selection_changes
 * (every squad add and remove) and ranking_events (active / inactive).
 */
import type { Env } from "./env";
import { sectionsFor, type AuthorizedUser } from "./auth";
import { HttpError } from "./http";
import { db, eq, inList } from "./data/supabase";
import { ACTOR_LABELS, actionLabel, changeText, fieldLabel, matchWhen, type HistoryEntry } from "../../shared/history";
import { displayName } from "../../shared/adminPeople";

export const HISTORY_ROWS = 50;
const API_ID = /^[A-Za-z0-9-]{3,64}$/;

export interface NameCols {
  preferred_name: string | null;
  given_names: string | null;
  surname: string | null;
}

export interface ActivityRowDb {
  occurred_at: string;
  action: string;
  fields: string[] | null;
  changes?: Record<string, unknown> | null;
  actor_label?: string | null;
  entity_id?: string | null;
  actor: NameCols | null;
}

export interface SquadChangeRowDb {
  occurred_at: string;
  side: "home" | "away";
  source: "coach" | "derby" | "release" | "replace";
  added: string[];
  removed: string[];
  actor: NameCols | null;
  match?: { match_date: string | null; home_team: string | null; away_team: string | null } | null;
}

const NAME_COLS = "preferred_name,given_names,surname";
export const ACTIVITY_SELECT = `occurred_at,action,fields,changes,actor_label,entity_id,actor:people!activity_log_actor_person_id_fkey(${NAME_COLS})`;
const SQUAD_SELECT = `occurred_at,side,source,added,removed,actor:people(${NAME_COLS})`;

export const iso = (t: string) => {
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? t : d.toISOString();
};

export const actorName = (r: { actor: NameCols | null; actor_label?: string | null }) =>
  r.actor ? displayName(r.actor) : r.actor_label ? (ACTOR_LABELS[r.actor_label] ?? null) : null;

const fixture = (m: { home_team: string | null; away_team: string | null } | null | undefined) =>
  m ? `${m.home_team ?? "?"} vs ${m.away_team ?? "?"}` : "a fixture";

/** What the hockey side of the app may show a coach: values only, never personal field names. */
const COACH_ACTIONS = new Set(["squad", "row-availability", "row-team-role", "activate", "deactivate"]);

/**
 * The People columns a coach sees changes of: the hockey side. The audit
 * keeps values for more (membership type and stage, hkid_hidden), which
 * only officers see (security review, 7 Oct 2026).
 */
export const COACH_FIELDS = new Set([
  "active", "opt_in_only", "registered_team", "selected_team_sos", "selected_team_eos", "previous_eos",
  "playing_position", "playing_level", "playing_ability", "is_visiting_player", "is_suspended", "matches_to_serve",
]);

/**
 * One activity_log row as an entry. `names` resolves the player of a coach's
 * answer (changes.person); `matches` the fixture it was for.
 */
export function activityEntry(
  r: ActivityRowDb,
  opts: { names?: Map<string, string>; matches?: Map<string, string>; forCoach?: boolean } = {},
): HistoryEntry | null {
  const changes = (r.changes ?? {}) as Record<string, unknown>;
  const base = { at: iso(r.occurred_at), actor: actorName(r), action: r.action };

  if (r.action === "row-availability") {
    const status = changes.status as [string, string] | undefined;
    const who = opts.names?.get(String(changes.person)) ?? null;
    const where = opts.matches?.get(String(r.entity_id ?? ""));
    return {
      ...base,
      summary: who ? `Answer for ${who}` : where ? `Answer for ${where}` : actionLabel(r.action),
      fields: [
        status ? `${status[0]} → ${status[1]}` : "",
        who && where ? where : "",
        (r.fields ?? []).includes("player_notes") ? "Note changed" : "",
      ].filter(Boolean),
    };
  }
  if (r.action === "row-team-role") {
    const role = fieldLabel(String(changes.role ?? ""));
    const team = String(changes.team ?? "");
    return {
      ...base,
      summary: `${changes.change === "removed" ? "Removed as" : "Added as"} ${role}${team ? `, ${team}` : ""}`,
      fields: [],
    };
  }
  if (r.action === "row-insert" || r.action === "row-delete") {
    return {
      ...base,
      summary: actionLabel(r.action),
      fields: [`${fixture(changes as { home_team: string | null; away_team: string | null })}, ${matchWhen(changes.match_date as string)}`],
    };
  }

  // Everything else: the fields that changed, with values where kept.
  const fields = (r.fields ?? []).filter((f) => !opts.forCoach || (f in changes && COACH_FIELDS.has(f)));
  if (opts.forCoach && !COACH_ACTIONS.has(r.action) && (!r.action.startsWith("row-") || fields.length === 0)) return null;
  return { ...base, summary: actionLabel(r.action), fields: fields.map((f) => changeText(f, changes[f])) };
}

/** A squad change as seen from the match: who went in and out of which side. */
export function squadEntryForMatch(
  r: SquadChangeRowDb,
  match: { home_team: string | null; away_team: string | null },
  names: Map<string, string>,
): HistoryEntry {
  const team = (r.side === "home" ? match.home_team : match.away_team) ?? r.side;
  const list = (ids: string[]) => ids.map((id) => names.get(id) ?? "someone no longer on record").join(", ");
  const how = { coach: "", derby: " (moved between sides)", release: " (released for another game that day)", replace: "" }[r.source];
  return {
    at: iso(r.occurred_at),
    actor: actorName(r),
    action: "squad",
    summary: `Squad ${team}${how}`,
    fields: [r.added.length ? `In: ${list(r.added)}` : "", r.removed.length ? `Out: ${list(r.removed)}` : ""].filter(Boolean),
  };
}

/** A squad change as seen from one player: picked for, or left out of, a fixture. */
export function squadEntryForPerson(r: SquadChangeRowDb, personUuid: string): HistoryEntry {
  const picked = r.added.includes(personUuid);
  const what = picked ? "Picked for" : r.source === "release" ? "Released from" : "Left out of";
  return {
    at: iso(r.occurred_at),
    actor: actorName(r),
    action: "squad",
    summary: `${what} ${fixture(r.match)}`,
    fields: [matchWhen(r.match?.match_date)],
  };
}

export const newestFirst = (entries: HistoryEntry[]) =>
  entries.sort((a, b) => b.at.localeCompare(a.at)).slice(0, HISTORY_ROWS);

/** People's names by uuid, in one read. */
async function namesFor(env: Env, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await db(env).select<NameCols & { id: string }>("people", `select=id,${NAME_COLS}&id=${inList(unique)}`);
  return new Map(rows.map((p) => [p.id, displayName(p)]));
}

/** Fixtures as "Home vs Away, Sat 10 Oct, 14:30" by uuid, in one read. */
async function fixturesFor(env: Env, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await db(env).select<{ id: string; match_date: string | null; home_team: string | null; away_team: string | null }>(
    "matches",
    `select=id,match_date,home_team,away_team&id=${inList(unique)}`,
  );
  return new Map(rows.map((m) => [m.id, `${fixture(m)}, ${matchWhen(m.match_date)}`]));
}

const isOfficer = (user: Pick<AuthorizedUser, "officerRoles">) => sectionsFor(user).includes("people");

/** GET /api/history?match=<api id>. */
export async function getMatchHistory(env: Env, user: AuthorizedUser, matchApiId: string): Promise<{ entries: HistoryEntry[] }> {
  if (!API_ID.test(matchApiId)) throw new HttpError("Choose a fixture.", 400, "INVALID_INPUT");
  const d = db(env);
  const match = await d.one<{ id: string; home_team: string | null; away_team: string | null }>(
    "matches",
    `select=id,home_team,away_team&api_id=${eq(matchApiId)}`,
  );
  if (!match) throw new HttpError("Fixture not found.", 404, "NOT_FOUND");
  const coaches = user.coachTeams.some((t) => t === match.home_team || t === match.away_team);
  if (!coaches && !isOfficer(user)) throw new HttpError("Only this fixture's coaches and officers can see its history.", 403, "COACH_ACCESS_REQUIRED");

  const [squads, log] = await Promise.all([
    d.select<SquadChangeRowDb>("match_selection_changes", `select=${SQUAD_SELECT}&match_id=${eq(match.id)}&order=occurred_at.desc&limit=${HISTORY_ROWS}`),
    d.select<ActivityRowDb>("activity_log", `select=${ACTIVITY_SELECT}&entity=eq.matches&entity_id=${eq(match.id)}&order=occurred_at.desc&limit=${HISTORY_ROWS}`),
  ]);
  const names = await namesFor(env, [
    ...squads.flatMap((s) => [...s.added, ...s.removed]),
    ...log.map((r) => String((r.changes ?? {}).person ?? "")),
  ]);
  return {
    entries: newestFirst([
      ...squads.map((s) => squadEntryForMatch(s, match, names)),
      ...log.map((r) => activityEntry(r, { names })).filter((e): e is HistoryEntry => e !== null),
    ]),
  };
}

/**
 * A person's squad changes and the answers coaches gave for them: the extra
 * reads behind GET /api/history?person= (admin/people.ts).
 */
export async function personHockeyHistory(env: Env, personUuid: string): Promise<HistoryEntry[]> {
  const d = db(env);
  const [squads, answers] = await Promise.all([
    d.select<SquadChangeRowDb>(
      "match_selection_changes",
      `select=${SQUAD_SELECT},match:matches(match_date,home_team,away_team)&or=(added.cs.{${personUuid}},removed.cs.{${personUuid}})&order=occurred_at.desc&limit=${HISTORY_ROWS}`,
    ),
    d.select<ActivityRowDb>(
      "activity_log",
      `select=${ACTIVITY_SELECT}&action=eq.row-availability&changes->>person=${eq(personUuid)}&order=occurred_at.desc&limit=${HISTORY_ROWS}`,
    ),
  ]);
  const matches = await fixturesFor(env, answers.map((a) => a.entity_id ?? ""));
  return [
    ...squads.map((s) => squadEntryForPerson(s, personUuid)),
    ...answers.map((r) => activityEntry(r, { matches })).filter((e): e is HistoryEntry => e !== null),
  ];
}

/** Whether a coach (not an officer) may see this person's hockey history: they coach the person's team. */
export function coachesPerson(
  user: Pick<AuthorizedUser, "coachTeams">,
  person: { registered_team: string | null; selected_team_sos: string | null; selected_team_eos: string | null },
): boolean {
  // The team the app shows them in, and their registered team.
  const shown = person.selected_team_eos || person.selected_team_sos || person.registered_team;
  const teams = new Set([shown, person.registered_team].filter((t): t is string => !!t));
  return user.coachTeams.some((t) => teams.has(t));
}

export { isOfficer };
