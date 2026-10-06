/**
 * Umpiring duties (Supabase backend): the club's umpires take HKFC's
 * umpiring duties, and the Umpire Coordinator (and the Section Captains)
 * fills the gaps, sends the week's WhatsApp messages and keeps the season's
 * record. See shared/umpiring.ts and
 * supabase/migrations/20261006200000_umpiring.sql.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { HttpError } from "./http";
import { backendFor } from "./data/backend";
import { db, eq, inList, SupabaseError } from "./data/supabase";
import { getCached, invalidateCache } from "./cache";
import { hkDateKey } from "../../shared/hkDateKey";
import { buildNameDictionary, canonicalKey, parseUmpire } from "../../shared/umpires";
import { NO_QUALIFICATION } from "../../shared/volunteering";
import {
  clashingGame,
  gameLabel,
  isOnCommitment,
  seasonOf,
  weekEnd,
  weekOf,
  type AssignmentStatus,
  type DutyAssignment,
  type DutyOutcome,
  type OwnGame,
  type TeamTally,
  type UmpireDuty,
  type UmpireOption,
  type UmpireTally,
  type UmpiringAccess,
  type UmpiringBoard,
  type UmpiringReport,
} from "../../shared/umpiring";

interface PersonRow {
  id: string;
  api_id: string;
  preferred_name: string | null;
  given_names: string | null;
  surname: string | null;
  qualified_umpire: string | null;
  commitment_end_date: string | null;
  selected_team_eos: string | null;
  selected_team_sos: string | null;
  registered_team: string | null;
}

interface DutyRow {
  id: string;
  match_date: string;
  time_tbc: boolean;
  division: string | null;
  venue: string | null;
  home_team: string;
  away_team: string;
  slot: 1 | 2;
  duty_team: string;
  status: UmpireDuty["status"];
}

interface AssignmentRow {
  id: string;
  duty_id: string;
  person_id: string | null;
  external_name: string | null;
  paid: boolean;
  status: AssignmentStatus;
  created_at: string;
}

const PERSON_COLUMNS =
  "id,api_id,preferred_name,given_names,surname,qualified_umpire,commitment_end_date,selected_team_eos,selected_team_sos,registered_team";
const DUTY_COLUMNS = "id,match_date,time_tbc,division,venue,home_team,away_team,slot,duty_team,status";
const ASSIGNMENT_COLUMNS = "id,duty_id,person_id,external_name,paid,status,created_at";

const DAY_MS = 24 * 60 * 60 * 1000;
const POOL_KEY = "umpiring:pool";

const today = () => hkDateKey(new Date().toISOString());
const firstName = (p: PersonRow) => (p.preferred_name || p.given_names || p.surname || "").trim().split(/\s+/)[0] ?? "";
const fullName = (p: PersonRow) => [p.preferred_name || p.given_names, p.surname].filter(Boolean).join(" ");
const qualified = (p: PersonRow) => !!p.qualified_umpire && p.qualified_umpire !== NO_QUALIFICATION;

function requireSupabase(env: Env): void {
  if (backendFor(env, "people") !== "supabase") {
    throw new HttpError("Umpiring duties are in Eddy from the switch-over.", 409, "NOT_YET");
  }
}

/** The Umpire Coordinator and the Section Captains run the duties. */
export function isCoordinator(user: AuthorizedUser): boolean {
  return user.officerRoles.some((r) => r.office === "umpireCoordinator" || r.office === "sectionCaptain");
}

/**
 * The club's umpires (People uuids): Active people with an umpiring level,
 * and anyone who umpired an HKFC game in the last 12 months, by name on
 * the match card (shared/umpires.ts) or confirmed in Eddy.
 */
async function umpirePool(env: Env): Promise<Map<string, PersonRow>> {
  const { data } = await getCached(
    POOL_KEY,
    async () => {
      const since = new Date(Date.now() - 365 * DAY_MS).toISOString();
      const [people, matches, umpired] = await Promise.all([
        db(env).select<PersonRow>("people", `select=${PERSON_COLUMNS}&active=is.true`),
        db(env).select<{ id: string; ump_1: string | null; ump_2: string | null; home_team: string | null; away_team: string | null }>(
          "matches",
          `select=id,ump_1,ump_2,home_team,away_team&match_date=gte.${encodeURIComponent(since)}&match_date=lte.${encodeURIComponent(new Date().toISOString())}`,
        ),
        db(env).select<{ id: string; person_id: string | null }>(
          "umpire_assignments",
          `select=id,person_id,umpire_duties!inner(match_date)&status=eq.confirmed&person_id=not.is.null&umpire_duties.match_date=gte.${encodeURIComponent(since)}&umpire_duties.match_date=lte.${encodeURIComponent(new Date().toISOString())}`,
        ),
      ]);
      const teams = new Set(matches.flatMap((m) => [m.home_team, m.away_team]).filter((t): t is string => !!t));
      const values = matches.flatMap((m) => [m.ump_1, m.ump_2]);
      const names = buildNameDictionary(values, teams);
      const keys = new Set(
        values.map((v) => parseUmpire(v, { teams, names }).key).filter((k): k is string => !!k),
      );
      const fromEddy = new Set(umpired.map((u) => u.person_id));
      const pool: [string, PersonRow][] = people
        .filter((p) => {
          if (qualified(p) || fromEddy.has(p.id)) return true;
          const asWritten = [`${p.given_names ?? ""} ${p.surname ?? ""}`, `${p.preferred_name ?? ""} ${p.surname ?? ""}`];
          return asWritten.some((n) => n.trim().includes(" ") && keys.has(canonicalKey(n)));
        })
        .map((p) => [p.id, p]);
      return pool;
    },
    10 * 60 * 1000,
  );
  return new Map(data);
}

async function personByApiId(env: Env, apiId: string): Promise<PersonRow> {
  const p = await db(env).one<PersonRow>("people", `select=${PERSON_COLUMNS}&api_id=${eq(apiId)}`);
  if (!p) throw new HttpError("Your People record was not found.", 404, "NOT_FOUND");
  return p;
}

/** Who may open the umpiring screen, and as what; null for no one else. */
export async function umpiringAccess(env: Env, user: AuthorizedUser): Promise<UmpiringAccess | null> {
  if (backendFor(env, "people") !== "supabase") return null;
  if (isCoordinator(user)) return "coordinator";
  // Asked on every player page: a failure here (a database without the
  // umpiring tables yet) hides the screen, never the page.
  try {
    const pool = await umpirePool(env);
    for (const p of pool.values()) if (p.api_id === user.personId) return "umpire";
  } catch (err) {
    console.error("Umpiring access not read:", err instanceof Error ? err.message : err);
  }
  return null;
}

async function requireAccess(env: Env, user: AuthorizedUser): Promise<{ access: UmpiringAccess; me: PersonRow }> {
  requireSupabase(env);
  const access = await umpiringAccess(env, user);
  if (!access) throw new HttpError("The umpiring duties are for the club's umpires.", 403, "UMPIRE_ACCESS_REQUIRED");
  return { access, me: await personByApiId(env, user.personId) };
}

function requireCoordinator(user: AuthorizedUser): void {
  if (!isCoordinator(user)) throw new HttpError("Only the Umpire Coordinator can do that.", 403, "OFFICER_ACCESS_REQUIRED");
}

/** Names for assignment rows: club umpires by first name, outside umpires as entered. */
async function namesFor(env: Env, rows: AssignmentRow[]): Promise<Map<string, PersonRow>> {
  const ids = [...new Set(rows.map((r) => r.person_id).filter((x): x is string => !!x))];
  if (ids.length === 0) return new Map();
  const people = await db(env).select<PersonRow>("people", `select=${PERSON_COLUMNS}&id=${inList(ids)}`);
  return new Map(people.map((p) => [p.id, p]));
}

function toAssignment(r: AssignmentRow, people: Map<string, PersonRow>): DutyAssignment {
  const p = r.person_id ? people.get(r.person_id) : undefined;
  return {
    id: r.id,
    personId: p?.api_id ?? null,
    name: r.external_name ?? (p ? firstName(p) : "?"),
    external: !!r.external_name,
    paid: r.paid,
    status: r.status,
    createdAt: r.created_at,
  };
}

function toDuty(d: DutyRow, assignments: DutyAssignment[]): UmpireDuty {
  return {
    id: d.id,
    matchDate: d.match_date,
    timeTbc: d.time_tbc,
    division: d.division,
    venue: d.venue,
    homeTeam: d.home_team,
    awayTeam: d.away_team,
    slot: d.slot,
    dutyTeam: d.duty_team,
    status: d.status,
    assignments,
  };
}

/** Duties between two HK dates (inclusive), with their live assignments. */
async function dutiesBetween(env: Env, from: string, to: string): Promise<UmpireDuty[]> {
  const start = new Date(`${from}T00:00:00+08:00`).toISOString();
  const end = new Date(new Date(`${to}T00:00:00+08:00`).getTime() + DAY_MS).toISOString();
  const rows = await db(env).select<DutyRow>(
    "umpire_duties",
    `select=${DUTY_COLUMNS}&match_date=gte.${encodeURIComponent(start)}&match_date=lt.${encodeURIComponent(end)}&order=match_date,id`,
  );
  if (rows.length === 0) return [];
  const assignments = await db(env).select<AssignmentRow>(
    "umpire_assignments",
    `select=${ASSIGNMENT_COLUMNS}&duty_id=${inList(rows.map((r) => r.id))}&status=neq.withdrawn&order=created_at,id`,
  );
  const people = await namesFor(env, assignments);
  const byDuty = new Map<string, DutyAssignment[]>();
  for (const a of assignments) {
    const list = byDuty.get(a.duty_id) ?? [];
    list.push(toAssignment(a, people));
    byDuty.set(a.duty_id, list);
  }
  return rows.map((d) => toDuty(d, byDuty.get(d.id) ?? []));
}

/**
 * Each person's own games between two HK dates: their team's (the team the
 * app shows them in) and any they're picked for, less those they've said
 * they're Unavailable for. For flagging duties that clash.
 */
async function ownGames(env: Env, people: PersonRow[], from: string, to: string): Promise<Map<string, OwnGame[]>> {
  const out = new Map<string, OwnGame[]>();
  if (people.length === 0) return out;
  const start = new Date(`${from}T00:00:00+08:00`).toISOString();
  const end = new Date(new Date(`${to}T00:00:00+08:00`).getTime() + DAY_MS).toISOString();
  const matches = await db(env).select<{ id: string; match_date: string; venue: string | null; home_team: string | null; away_team: string | null }>(
    "matches",
    `select=id,match_date,venue,home_team,away_team&match_date=gte.${encodeURIComponent(start)}&match_date=lt.${encodeURIComponent(end)}&match_status=neq.Rescheduled`,
  );
  if (matches.length === 0) return out;
  const ids = matches.map((m) => m.id);
  const personIds = people.map((p) => p.id);
  const [selections, unavailable] = await Promise.all([
    db(env).select<{ match_id: string; person_id: string }>(
      "match_selections",
      `select=match_id,person_id&match_id=${inList(ids)}&person_id=${inList(personIds)}`,
      "match_id,side,person_id",
    ),
    db(env).select<{ id: string; match_id: string; person_id: string }>(
      "availability_exceptions",
      `select=id,match_id,person_id&match_id=${inList(ids)}&person_id=${inList(personIds)}&status=eq.Unavailable`,
    ),
  ]);
  const picked = new Set(selections.map((s) => `${s.person_id}|${s.match_id}`));
  const notPlaying = new Set(unavailable.map((u) => `${u.person_id}|${u.match_id}`));
  for (const p of people) {
    const team = p.selected_team_eos || p.selected_team_sos || p.registered_team || "";
    const games = matches
      .filter((m) => !notPlaying.has(`${p.id}|${m.id}`) && (picked.has(`${p.id}|${m.id}`) || (!!team && (m.home_team === team || m.away_team === team))))
      .map((m) => ({ matchDate: m.match_date, venue: m.venue, homeTeam: m.home_team ?? "", awayTeam: m.away_team ?? "" }));
    if (games.length) out.set(p.id, games);
  }
  return out;
}

/** Marks each duty with the viewer's clash and, for the coordinator, who else is playing then. */
function markClashes(duties: UmpireDuty[], games: Map<string, OwnGame[]>, me: PersonRow, others: PersonRow[]): void {
  for (const d of duties) {
    const mine = clashingGame(d, games.get(me.id) ?? []);
    if (mine) d.clash = gameLabel(mine);
    const clashes: Record<string, string> = {};
    for (const p of others) {
      const g = clashingGame(d, games.get(p.id) ?? []);
      if (g) clashes[p.api_id] = gameLabel(g).split(" ")[0];
    }
    if (others.length) d.clashes = clashes;
  }
}

/** Mondays of the weeks with duties: the last four weeks and everything to come. */
async function dutyWeeks(env: Env, coordinator: boolean): Promise<string[]> {
  const since = new Date(Date.now() - (coordinator ? 28 : 0) * DAY_MS);
  const rows = await db(env).select<{ id: string; match_date: string }>(
    "umpire_duties",
    `select=id,match_date&status=neq.cancelled&match_date=gte.${encodeURIComponent(new Date(`${weekOf(since.toISOString())}T00:00:00+08:00`).toISOString())}&order=match_date,id`,
  );
  return [...new Set(rows.map((r) => weekOf(r.match_date)))];
}

export async function getUmpiringBoard(env: Env, user: AuthorizedUser, weekParam: string | null): Promise<UmpiringBoard> {
  const { access, me } = await requireAccess(env, user);
  const coordinator = access === "coordinator";
  const thisWeek = weekOf(new Date().toISOString());
  const weeks = await dutyWeeks(env, coordinator);
  // Default: this week while it still has games to come, else the next week with duties.
  let week = weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam) ? weekOf(`${weekParam}T12:00:00+08:00`) : null;
  if (!week) week = weeks.find((w) => w >= thisWeek) ?? thisWeek;
  // Umpires see the weeks to come only.
  if (!coordinator && week < thisWeek) week = thisWeek;

  const duties = await dutiesBetween(env, week, weekEnd(week));
  const pool = await umpirePool(env);
  const others = coordinator ? [...pool.values()] : [];
  const games = await ownGames(env, [me, ...others.filter((p) => p.id !== me.id)], week, weekEnd(week));
  markClashes(duties, games, me, others);
  const now = today();
  const board: UmpiringBoard = {
    access,
    week,
    weeks: [...new Set([...weeks, week])].sort(),
    duties,
    me: {
      personId: me.api_id,
      isUmpire: pool.has(me.id),
      onCommitment: isOnCommitment(me.commitment_end_date, now),
      commitmentEndDate: me.commitment_end_date,
    },
    link: `${(env.APP_ORIGIN ?? "https://app.eddy.global").replace(/\/+$/, "")}/umpiring?week=${week}`,
    messages: user.officerRoles.some((r) => r.office === "umpireCoordinator"),
  };
  if (coordinator) {
    board.umpires = [...pool.values()]
      .map<UmpireOption>((p) => ({ personId: p.api_id, name: firstName(p), fullName: fullName(p), onCommitment: isOnCommitment(p.commitment_end_date, now) }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    const outside = await db(env).select<{ id: string; external_name: string; created_at: string }>(
      "umpire_assignments",
      "select=id,external_name,created_at&external_name=not.is.null&order=created_at.desc,id",
    );
    board.externalNames = [...new Set(outside.map((o) => o.external_name))].slice(0, 20);
  }
  return board;
}

// ── Taking and changing duties ─────────────────────────────────────────

async function dutyRow(env: Env, dutyId: string): Promise<DutyRow> {
  if (!/^[0-9a-f-]{36}$/.test(dutyId)) throw new HttpError("That duty was not found.", 404, "NOT_FOUND");
  const d = await db(env).one<DutyRow>("umpire_duties", `select=${DUTY_COLUMNS}&id=${eq(dutyId)}`);
  if (!d) throw new HttpError("That duty was not found.", 404, "NOT_FOUND");
  return d;
}

async function liveAssignments(env: Env, dutyId: string): Promise<AssignmentRow[]> {
  return db(env).select<AssignmentRow>("umpire_assignments", `select=${ASSIGNMENT_COLUMNS}&duty_id=${eq(dutyId)}&status=neq.withdrawn`);
}

function requireUpcoming(d: DutyRow): void {
  if (d.status === "cancelled") throw new HttpError("HKHA has taken this game off the list.", 409, "DUTY_CANCELLED");
  // A TBC kick-off is midnight: open until the day is over.
  const starts = new Date(d.match_date).getTime() + (d.time_tbc ? DAY_MS : 0);
  if (starts <= Date.now()) throw new HttpError("This game has already started.", 409, "DUTY_PAST");
}

const taken = () => new HttpError("Someone has already taken this game.", 409, "DUTY_TAKEN");

/** A unique-index clash is someone else getting there first. */
async function writing<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof SupabaseError && err.code === "23505") throw taken();
    throw err;
  }
}

function afterChange(): void {
  // Someone who umpires for the first time joins the list.
  invalidateCache(POOL_KEY);
}

/**
 * An umpire puts their own name down. Unpaid is confirmed at once; paid
 * (only once their commitment has ended) is an offer for the coordinator.
 */
export async function takeDuty(env: Env, user: AuthorizedUser, dutyId: string, body: Record<string, unknown>) {
  const { me } = await requireAccess(env, user);
  const paid = body.paid === true;
  if (paid && isOnCommitment(me.commitment_end_date, today())) {
    throw new HttpError("Umpiring is unpaid until your commitment ends.", 400, "ON_COMMITMENT");
  }
  const d = await dutyRow(env, dutyId);
  requireUpcoming(d);
  const live = await liveAssignments(env, d.id);
  if (live.some((a) => a.status === "confirmed" || a.status === "no_show")) throw taken();
  const mine = live.find((a) => a.person_id === me.id);
  const now = new Date().toISOString();
  await writing(async () => {
    if (mine) {
      // Their paid offer becomes unpaid (confirmed), or stays an offer.
      await db(env).update("umpire_assignments", `id=${eq(mine.id)}`, paid ? { paid: true } : { paid: false, status: "confirmed", confirmed_at: now });
    } else {
      await db(env).insert("umpire_assignments", [
        { duty_id: d.id, person_id: me.id, paid, status: paid ? "offered" : "confirmed", confirmed_at: paid ? null : now, created_by: me.id },
      ]);
    }
  });
  afterChange();
  return { ok: true, status: paid ? "offered" : "confirmed" };
}

async function assignmentRow(env: Env, id: string): Promise<AssignmentRow> {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError("That entry was not found.", 404, "NOT_FOUND");
  const a = await db(env).one<AssignmentRow>("umpire_assignments", `select=${ASSIGNMENT_COLUMNS}&id=${eq(id)}`);
  if (!a) throw new HttpError("That entry was not found.", 404, "NOT_FOUND");
  return a;
}

/** Pulls out: the umpire themselves, or the coordinator for anyone. */
export async function withdrawAssignment(env: Env, user: AuthorizedUser, id: string) {
  const { me } = await requireAccess(env, user);
  const a = await assignmentRow(env, id);
  if (a.person_id !== me.id) requireCoordinator(user);
  if (a.status === "withdrawn") return { ok: true };
  await db(env).update("umpire_assignments", `id=${eq(a.id)}`, { status: "withdrawn" });
  afterChange();
  return { ok: true };
}

/** The coordinator confirms an offer (a paid one, usually). */
export async function confirmAssignment(env: Env, user: AuthorizedUser, id: string) {
  await requireAccess(env, user);
  requireCoordinator(user);
  const a = await assignmentRow(env, id);
  if (a.status !== "offered") throw new HttpError("Only an offer can be confirmed.", 409, "NOT_AN_OFFER");
  const d = await dutyRow(env, a.duty_id);
  if (d.status === "cancelled") throw new HttpError("HKHA has taken this game off the list.", 409, "DUTY_CANCELLED");
  await writing(() => db(env).update("umpire_assignments", `id=${eq(a.id)}`, { status: "confirmed", confirmed_at: new Date().toISOString() }));
  afterChange();
  return { ok: true };
}

/**
 * The coordinator puts someone down: a club umpire (anyone Active, so an
 * umpire who answered on WhatsApp can be added) or an outside umpire by
 * name, who is always paid. Confirmed at once.
 */
export async function assignDuty(env: Env, user: AuthorizedUser, dutyId: string, body: Record<string, unknown>) {
  const { me } = await requireAccess(env, user);
  requireCoordinator(user);
  const d = await dutyRow(env, dutyId);
  if (d.status === "cancelled") throw new HttpError("HKHA has taken this game off the list.", 409, "DUTY_CANCELLED");
  const personId = typeof body.personId === "string" ? body.personId.trim() : "";
  const externalName = typeof body.externalName === "string" ? body.externalName.trim().replace(/\s+/g, " ") : "";
  if (!!personId === !!externalName) throw new HttpError("Choose a club umpire, or type an outside umpire's name.", 400, "INVALID_INPUT");
  if (externalName.length > 60) throw new HttpError("That name is too long.", 400, "INVALID_INPUT");

  const live = await liveAssignments(env, d.id);
  if (live.some((a) => a.status === "confirmed" || a.status === "no_show")) throw taken();
  const now = new Date().toISOString();

  if (externalName) {
    await writing(() =>
      db(env).insert("umpire_assignments", [
        { duty_id: d.id, external_name: externalName, paid: true, status: "confirmed", confirmed_at: now, created_by: me.id },
      ]),
    );
    return { ok: true };
  }

  const person = await db(env).one<PersonRow & { active: boolean | null }>("people", `select=${PERSON_COLUMNS},active&api_id=${eq(personId)}`);
  if (!person || person.active !== true) throw new HttpError("That person is not an Active member.", 400, "INVALID_INPUT");
  const paid = body.paid === true;
  if (paid && isOnCommitment(person.commitment_end_date, today())) {
    throw new HttpError(`${firstName(person)} is still on their commitment, so umpires unpaid.`, 400, "ON_COMMITMENT");
  }
  const theirs = live.find((a) => a.person_id === person.id);
  await writing(async () => {
    if (theirs) await db(env).update("umpire_assignments", `id=${eq(theirs.id)}`, { paid, status: "confirmed", confirmed_at: now });
    else await db(env).insert("umpire_assignments", [{ duty_id: d.id, person_id: person.id, paid, status: "confirmed", confirmed_at: now, created_by: me.id }]);
  });
  afterChange();
  return { ok: true };
}

/** The coordinator marks a played game's umpire as a no-show, or undoes it. */
export async function setNoShow(env: Env, user: AuthorizedUser, id: string, body: Record<string, unknown>) {
  await requireAccess(env, user);
  requireCoordinator(user);
  const a = await assignmentRow(env, id);
  const noShow = body.noShow === true;
  if (a.status !== (noShow ? "confirmed" : "no_show")) throw new HttpError("Only the game's umpire can be marked.", 409, "NOT_CONFIRMED");
  const d = await dutyRow(env, a.duty_id);
  if (new Date(d.match_date).getTime() > Date.now()) throw new HttpError("The game hasn't been played yet.", 409, "DUTY_FUTURE");
  await db(env).update("umpire_assignments", `id=${eq(a.id)}`, { status: noShow ? "no_show" : "confirmed" });
  afterChange();
  return { ok: true };
}

// ── The season's record ────────────────────────────────────────────────

/**
 * Games umpired: confirmed umpires of played games (no-shows counted
 * apart). The coordinator's season report, and a person's own count for
 * their commitment review.
 */
export function tallyDuties(duties: UmpireDuty[], season: string): UmpiringReport {
  const tallies = new Map<string, UmpireTally>();
  const byTeam = new Map<string, TeamTally>();
  const report: UmpiringReport = { season, duties: 0, coveredFree: 0, coveredPaidMembers: 0, coveredExternal: 0, noShows: 0, uncovered: 0, umpires: [], byTeam: [], rows: [] };
  for (const d of [...duties].sort((x, y) => x.matchDate.localeCompare(y.matchDate) || x.dutyTeam.localeCompare(y.dutyTeam))) {
    if (d.status === "cancelled") continue;
    report.duties++;
    const team = byTeam.get(d.dutyTeam) ?? { team: d.dutyTeam, duties: 0, free: 0, paidMembers: 0, outside: 0, uncovered: 0 };
    team.duties++;
    byTeam.set(d.dutyTeam, team);
    const a = d.assignments.find((x) => x.status === "confirmed" || x.status === "no_show");
    const outcome: DutyOutcome = !a ? "uncovered" : a.status === "no_show" ? "no_show" : a.external ? "outside" : a.paid ? "paid" : "free";
    report.rows.push({
      matchDate: d.matchDate, timeTbc: d.timeTbc, venue: d.venue, division: d.division, homeTeam: d.homeTeam, awayTeam: d.awayTeam,
      dutyTeam: d.dutyTeam, personId: a?.personId ?? null, umpire: a?.name ?? null, short: a?.name ?? null, outcome,
    });
    if (!a) {
      report.uncovered++;
      team.uncovered++;
      continue;
    }
    const key = a.personId ?? `external:${a.name.toLowerCase()}`;
    const t = tallies.get(key) ?? { name: a.name, personId: a.personId, external: a.external, free: 0, paid: 0, noShows: 0 };
    tallies.set(key, t);
    if (a.status === "no_show") {
      t.noShows++;
      report.noShows++;
      report.uncovered++;
      team.uncovered++;
      continue;
    }
    if (a.paid) t.paid++;
    else t.free++;
    if (a.external) {
      report.coveredExternal++;
      team.outside++;
    } else if (a.paid) {
      report.coveredPaidMembers++;
      team.paidMembers++;
    } else {
      report.coveredFree++;
      team.free++;
    }
  }
  report.umpires = [...tallies.values()].sort((a, b) => b.free + b.paid - (a.free + a.paid) || a.name.localeCompare(b.name));
  report.byTeam = [...byTeam.values()].sort((a, b) => a.team.localeCompare(b.team));
  return report;
}

/** The played part of a season (July to June), so far. */
function seasonRange(season: string): { from: string; to: string } {
  const start = Number(season.slice(0, 4));
  const end = `${start + 1}-06-30`;
  const yesterday = hkDateKey(new Date(Date.now() - DAY_MS).toISOString());
  return { from: `${start}-07-01`, to: yesterday < end ? yesterday : end };
}

export async function getUmpiringReport(env: Env, user: AuthorizedUser, seasonParam: string | null): Promise<UmpiringReport> {
  await requireAccess(env, user);
  requireCoordinator(user);
  const season = seasonParam && /^\d{4}-\d{4}$/.test(seasonParam) ? seasonParam : seasonOf(new Date().toISOString());
  const { from, to } = seasonRange(season);
  if (to < from) return tallyDuties([], season);
  const duties = await dutiesBetween(env, from, to);
  // Full names in the report: two Georges are told apart.
  const report = tallyDuties(duties, season);
  const ids = report.umpires.map((u) => u.personId).filter((x): x is string => !!x);
  if (ids.length) {
    const people = await db(env).select<PersonRow>("people", `select=${PERSON_COLUMNS}&api_id=${inList(ids)}`);
    const names = new Map(people.map((p) => [p.api_id, fullName(p)]));
    for (const u of report.umpires) if (u.personId) u.name = names.get(u.personId) || u.name;
    for (const r of report.rows) if (r.personId) r.umpire = names.get(r.personId) || r.umpire;
  }
  return report;
}

/**
 * Games a person umpired in Eddy between two dates (yyyy-mm-dd, HK):
 * confirmed, played, not a no-show. For their commitment review.
 */
export async function gamesUmpiredBetween(env: Env, personApiId: string, from: string, to: string): Promise<number> {
  if (backendFor(env, "people") !== "supabase") return 0;
  const person = await db(env).one<{ id: string }>("people", `select=id&api_id=${eq(personApiId)}`);
  if (!person) return 0;
  const start = new Date(`${from}T00:00:00+08:00`).toISOString();
  const end = new Date(Math.min(Date.now(), new Date(`${to}T00:00:00+08:00`).getTime() + DAY_MS)).toISOString();
  const rows = await db(env).select<{ id: string }>(
    "umpire_assignments",
    `select=id,umpire_duties!inner(match_date,status)&person_id=${eq(person.id)}&status=eq.confirmed` +
      `&umpire_duties.match_date=gte.${encodeURIComponent(start)}&umpire_duties.match_date=lt.${encodeURIComponent(end)}&umpire_duties.status=neq.cancelled`,
  );
  return rows.length;
}
