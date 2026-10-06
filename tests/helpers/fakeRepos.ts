import { afterEach, beforeEach, vi } from "vitest";
import * as peopleModule from "../../worker/src/data/people";
import * as teamsModule from "../../worker/src/data/teams";
import * as officersModule from "../../worker/src/data/officers";
import * as matchesModule from "../../worker/src/data/matches";
import * as matchCardsModule from "../../worker/src/data/matchCards";
import * as exceptionsModule from "../../worker/src/data/availabilityExceptions";
import * as rulesModule from "../../worker/src/data/availabilityRules";
import * as abilityGroupsModule from "../../worker/src/data/abilityGroups";
import * as rankingEventsModule from "../../worker/src/data/rankingEvents";
import * as membershipEventsModule from "../../worker/src/data/membershipEvents";
import * as suspensionsModule from "../../worker/src/data/suspensions";
import * as seasonDataModule from "../../worker/src/data/seasonData";
import type { SeasonData } from "../../worker/src/data/seasonData";
import * as commitmentsModule from "../../worker/src/data/commitments";
import * as authContextModule from "../../worker/src/authContext";
import * as cacheVersionsModule from "../../worker/src/cacheVersions";
import { noteRequestWrite } from "../../worker/src/requestContext";
import type { AuthContext } from "../../worker/src/authContext";
import type { AuthorizedUser } from "../../worker/src/auth";
import { signedIn } from "./factories";
import { CACHE_VERSION_KEYS, parseCacheVersions, type CacheVersions } from "../../worker/src/cacheVersions";
import type { PeopleRepo, PersonPatch } from "../../worker/src/data/people";
import {
  APPLICANT_STAGE_FIELDS, APPLICANT_TASK_FIELDS, CONTACT_FIELDS, EXPORT_FIELDS, MY_TASK_FIELDS, NAME_FIELDS, NUMBER_HOLDER_FIELDS,
} from "../../worker/src/data/people";
import type { TeamsRepo } from "../../worker/src/data/teams";
import type { Office, OfficersRepo } from "../../worker/src/data/officers";
import type { MatchesRepo } from "../../worker/src/data/matches";
import type { MatchCardsRepo } from "../../worker/src/data/matchCards";
import type { AvailabilityExceptionsRepo, AvailabilityOutcome } from "../../worker/src/data/availabilityExceptions";
import { SupabaseError } from "../../worker/src/data/supabase";
import { needsExplicitAvailable } from "../../worker/src/availabilityRules";
import { UNRANKED_TEAM_RANK } from "../../worker/src/reference";
import { hkDateKey } from "../../shared/hkDateKey";
import type { AvailabilityRulesRepo } from "../../worker/src/data/availabilityRules";
import type { AbilityGroupsRepo } from "../../worker/src/data/abilityGroups";
import type { RankingEventRow, RankingEventsRepo } from "../../worker/src/data/rankingEvents";
import type { MembershipEventsRepo, NewMembershipEvent } from "../../worker/src/data/membershipEvents";
import type { SuspensionsRepo } from "../../worker/src/data/suspensions";
import type { ManualSuspension } from "../../worker/src/suspension";
import type { CommitmentsRepo } from "../../worker/src/data/commitments";
import { NOTIFY_FIELDS, REVIEW_TASK_FIELDS } from "../../worker/src/data/commitments";
import type { FieldList, Row } from "../../worker/src/data/rows";
import { API_ID_RE } from "../../worker/src/data/ids";
import { HttpError } from "../../worker/src/http";
import { CHAIRMAN_FIELDS, COMMITMENT_FIELDS, MEMBERSHIP_FIELDS } from "../../shared/schema/fieldMaps";
import { normalizeEmail } from "../../shared/normalizeEmail";
import { REVIEWS_FROM } from "../../shared/statementStages";
import type {
  AbilityGroupConfiguration, AvailabilityException, AvailabilityRule, Match, MatchCard, Player, Team,
} from "../../shared/schema/domainTypes";

/**
 * In-memory repositories: every interface in worker/src/data/*.ts, backed by
 * plain arrays a test seeds and inspects. They behave like the SUPABASE
 * implementations (worker/src/data/supabase/*), which are the ones that run
 * in production: the same filters, the same "blank counts as different" for
 * a != filter, the same errors for a missing row. Writes mutate the arrays.
 *
 * Installed by spying on each module accessor (people(env), teams(env),
 * ...): the seam the data modules keep for tests.
 */

// ── State ────────────────────────────────────────────────────────────────

/** Every key a People row view (api_people_crm) can carry. */
type PeopleCrmKey =
  | (typeof MEMBERSHIP_FIELDS)[number]
  | (typeof CHAIRMAN_FIELDS)[number]
  | (typeof EXPORT_FIELDS)[number]
  | (typeof NUMBER_HOLDER_FIELDS)[number]
  | (typeof APPLICANT_STAGE_FIELDS)[number]
  | (typeof CONTACT_FIELDS)[number]
  | (typeof NAME_FIELDS)[number]
  | (typeof MY_TASK_FIELDS)[number]
  | (typeof APPLICANT_TASK_FIELDS)[number];

/**
 * One People row: the Player the squad reads see, plus `crm`, the officer
 * sections' columns (api_people_crm) that are not Player fields or have
 * another shape there (photo is an attachment list in the CRM views, a URL
 * on Player). A row view reads `crm[key]` first, then the Player field of
 * that name, so status/applicantStage/names need setting only once.
 */
export type FakePerson = Player & { crm?: Partial<Record<PeopleCrmKey, unknown>> };

/** One office row as api_offices has it. */
export interface FakeOffice {
  id: string;
  office: Office;
  designation?: string | null;
  /** "Active" or "Retired". */
  status: string;
  /** The holder's People id; null for a vacant row. */
  member: string | null;
}

/** An availability exception, plus who gave the answer (not on the domain type). */
export type FakeException = AvailabilityException & { updatedBy?: string };

type CommitmentKey = (typeof COMMITMENT_FIELDS)[number] | (typeof NOTIFY_FIELDS)[number] | (typeof REVIEW_TASK_FIELDS)[number];
/** One Commitments row as api_commitments_crm has it, keyed by its column names. */
export type FakeCommitment = { id: string } & Partial<Record<CommitmentKey, unknown>>;

export interface FakeState {
  people: FakePerson[];
  teams: Team[];
  officers: FakeOffice[];
  matches: Match[];
  matchCards: MatchCard[];
  availabilityExceptions: FakeException[];
  availabilityRules: AvailabilityRule[];
  abilityGroups: AbilityGroupConfiguration[];
  rankingEvents: RankingEventRow[];
  membershipEvents: NewMembershipEvent[];
  commitments: FakeCommitment[];
  /** Open manual suspensions (api_suspensions, cleared_at null). */
  suspensions: ManualSuspension[];
}

export type RepoName = keyof FakeState;

export interface FakeRepos {
  people: PeopleRepo;
  teams: TeamsRepo;
  officers: OfficersRepo;
  matches: MatchesRepo;
  matchCards: MatchCardsRepo;
  availabilityExceptions: AvailabilityExceptionsRepo;
  availabilityRules: AvailabilityRulesRepo;
  abilityGroups: AbilityGroupsRepo;
  rankingEvents: RankingEventsRepo;
  membershipEvents: MembershipEventsRepo;
  commitments: CommitmentsRepo;
  suspensions: SuspensionsRepo;
}

export interface RepoCall {
  repo: RepoName;
  method: string;
  args: unknown[];
}

export interface FakeReposHandle {
  /** The arrays behind the repositories. Seed them, mutate them, assert on them. */
  state: FakeState;
  /** The repository objects the code under test receives (spy on a method to make it fail). */
  repos: FakeRepos;
  /** Every repository call, in order. */
  calls: RepoCall[];
  /** Calls to one repository, optionally one method. */
  callsTo(repo: RepoName, method?: string): RepoCall[];
  /** Empties every array (and the call log), then copies `seed` in. */
  reset(seed?: Partial<FakeState>): void;
  /** Puts the real accessors back. */
  restore(): void;
  /**
   * The signed-in user auth.ts would build for this email from the seeded
   * state (auth_context's person, captaincies, offices, umpire flag), with
   * `overrides` on top. Unlike requireAuthorizedUser it never refuses.
   */
  signedIn(email: string, overrides?: Partial<AuthorizedUser>): AuthorizedUser;
}

export function emptyState(): FakeState {
  return {
    people: [], teams: [], officers: [], matches: [], matchCards: [], availabilityExceptions: [], availabilityRules: [],
    abilityGroups: [], rankingEvents: [], membershipEvents: [], commitments: [], suspensions: [],
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** A copy, so code under test cannot change the state by mutating what it was given. */
const clone = <T>(v: T): T => structuredClone(v);

let uuidSeq = 0;
/** A uuid-shaped id, as Supabase gives a row created in Eddy (passes API_ID_RE). */
export function fakeUuid(): string {
  uuidSeq++;
  return `00000000-0000-4000-8000-${String(uuidSeq).padStart(12, "0")}`;
}

/** Blank as Postgres sees it for a not-null/!= test: null, undefined or "". */
const blank = (v: unknown) => v === undefined || v === null || v === "";
/** "column <> value" counting a blank as different, as the Supabase reads do. */
const differs = (v: unknown, value: string) => blank(v) || v !== value;
/** A lookup may be a one-element list; compare its first value. */
const scalar = (v: unknown) => (Array.isArray(v) ? v[0] : v);

/**
 * The Player fields toPlayer() (data/supabase/mappers.ts) fills. Anything
 * else on a FakePerson is not returned - teamRank and positionalRank
 * included: they are derived by the ranking engine, never stored.
 */
const PLAYER_KEYS: (keyof Player)[] = [
  "id", "preferredName", "givenNames", "surname", "shirtNoValue", "email", "mobileNo", "active", "registeredTeam",
  "selectedTeamSos", "selectedTeamEos", "playingPosition", "playingAbility", "isVisitingPlayer", "isSuspended",
  "matchesToServe", "everRegisteredToPremier", "u21Eligible", "playerCoach", "sectionRank",
  "rankUpdatedAt", "status", "applicantStage", "photo", "sportsBackground", "selectionComments", "optInOnly", "birthday",
];
const PLAYER_KEY_SET = new Set<string>(PLAYER_KEYS);

function toPlayer(p: FakePerson): Player {
  const out: Record<string, unknown> = {};
  // Like toPlayer(), an empty text reads as "not set".
  for (const k of PLAYER_KEYS) if (p[k] !== undefined && p[k] !== null && p[k] !== "") out[k] = clone(p[k]);
  return out as unknown as Player;
}

/** api_people_crm names APPLICANT_TASK_FIELDS.stage "applicantStage" (data/supabase/crm.ts ALIASES). */
const PEOPLE_ALIASES: Record<string, string> = { stage: "applicantStage" };

function personValue(p: FakePerson, key: string): unknown {
  const column = PEOPLE_ALIASES[key] ?? key;
  const crm = p.crm as Record<string, unknown> | undefined;
  if (crm && column in crm) return crm[column];
  return (p as unknown as Record<string, unknown>)[column];
}

function personRow<M extends FieldList>(p: FakePerson, map: M): Row<M> {
  const row: Record<string, unknown> = { id: p.id };
  for (const key of map) {
    const v = personValue(p, key);
    if (v !== undefined && v !== null) row[key] = clone(v);
  }
  return row as Row<M>;
}

function commitmentRow<M extends FieldList>(c: FakeCommitment, map: M): Row<M> {
  const row: Record<string, unknown> = { id: c.id };
  for (const key of map) {
    const v = (c as Record<string, unknown>)[key];
    if (v !== undefined && v !== null) row[key] = clone(v);
  }
  return row as Row<M>;
}

/** Removes in place, so a test holding the array sees the delete. */
function removeWhere<T>(rows: T[], pred: (row: T) => boolean): void {
  for (let i = rows.length - 1; i >= 0; i--) if (pred(rows[i])) rows.splice(i, 1);
}

const addDays = (dayKey: string, n: number) =>
  new Date(Date.parse(`${dayKey}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ── The repositories ─────────────────────────────────────────────────────

function buildRepos(s: FakeState): FakeRepos {
  const findPerson = (id: string) => s.people.find((p) => p.id === id);

  const patchPerson = (p: FakePerson, patch: PersonPatch) => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      // null clears the column; toPlayer() reads a null as "not set".
      const v = value === null ? undefined : value;
      if (PLAYER_KEY_SET.has(key)) (p as unknown as Record<string, unknown>)[key] = v;
      if (!PLAYER_KEY_SET.has(key) || (p.crm && key in p.crm)) {
        p.crm ??= {};
        (p.crm as Record<string, unknown>)[key] = v;
      }
    }
  };

  const people: PeopleRepo = {
    async listActive() {
      // api_players_lite: no photo, CV, coach notes, Player/Coach or rank date.
      return s.people.filter((p) => p.active === true).map((p) => {
        const { photo: _photo, sportsBackground: _cv, selectionComments: _notes, playerCoach: _pc, rankUpdatedAt: _rank, ...lite } = toPlayer(p);
        return lite;
      });
    },
    async findByEmail(email) {
      const want = normalizeEmail(email);
      const rows = s.people.filter((p) => typeof p.email === "string" && normalizeEmail(p.email) === want);
      const chosen = rows.find((p) => p.active) ?? rows[0];
      return chosen ? toPlayer(chosen) : null;
    },
    async getById(id) {
      const p = findPerson(id);
      return p ? toPlayer(p) : null;
    },
    async listRankingPool() {
      return s.people
        .filter((p) => (p.active === true || p.status === "Applicant") && differs(p.applicantStage, "Rejected") && differs(p.status, "Resigned"))
        .map(toPlayer);
    },
    async listInactiveRankable() {
      return s.people
        .filter((p) => p.active === false && differs(p.status, "Applicant") && differs(p.status, "Resigned") && differs(p.applicantStage, "Rejected"))
        .map(toPlayer);
    },
    async update(id, patch) {
      const p = findPerson(id);
      if (!p) throw new Error(`No person ${id}`);
      patchPerson(p, patch);
    },
    async updateMany(updates) {
      // One transaction on Supabase (update_people_ranks): all or nothing.
      for (const { id } of updates) if (!findPerson(id)) throw new Error(`No person ${id}`);
      for (const { id, patch } of updates) patchPerson(findPerson(id)!, patch);
    },
    async listMembershipBoard() {
      return s.people
        .filter((p) => !blank(personValue(p, "applicantStage")) && differs(personValue(p, "status"), "Resigned"))
        .map((p) => personRow(p, MEMBERSHIP_FIELDS));
    },
    async listActiveForExport() {
      return s.people
        .filter((p) => personValue(p, "active") === true && differs(personValue(p, "applicantStage"), "Temporary"))
        .map((p) => personRow(p, EXPORT_FIELDS));
    },
    async listByMembershipNo(membershipNo) {
      return s.people.filter((p) => personValue(p, "membershipNo") === membershipNo).map((p) => personRow(p, NUMBER_HOLDER_FIELDS));
    },
    async getApplicantStage(id) {
      const p = findPerson(id);
      return p ? personRow(p, APPLICANT_STAGE_FIELDS) : null;
    },
    async listDirectory() {
      return s.people.filter((p) => differs(personValue(p, "status"), "Resigned")).map((p) => personRow(p, CHAIRMAN_FIELDS));
    },
    async listContactsByIds(ids) {
      const wanted = new Set([...ids].filter((id) => API_ID_RE.test(id)));
      return s.people.filter((p) => wanted.has(p.id)).map((p) => personRow(p, CONTACT_FIELDS));
    },
    async listNames() {
      return s.people.map((p) => personRow(p, NAME_FIELDS));
    },
    async getMyTaskFields(id) {
      const p = findPerson(id);
      return p ? personRow(p, MY_TASK_FIELDS) : null;
    },
    async listApplicantsAtStages(stages) {
      return s.people
        .filter((p) => stages.includes(personValue(p, "applicantStage") as string))
        .map((p) => personRow(p, APPLICANT_TASK_FIELDS));
    },
  };

  const teams: TeamsRepo = {
    async listActive() {
      return s.teams.filter((t) => t.active === true).map(clone);
    },
    async listAll() {
      return s.teams.map(clone);
    },
    async setAutoSelectPlayers(teamId, playerIds) {
      const t = s.teams.find((x) => x.id === teamId);
      if (!t) throw new Error(`No team ${teamId}`);
      t.autoSelectPlayers = [...playerIds];
    },
  };

  const officeRows = (offices: readonly Office[], activeOnly: boolean) =>
    offices.flatMap((office) =>
      s.officers
        .filter((r) => r.office === office && (!activeOnly || r.status === "Active"))
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
  const officers: OfficersRepo = {
    async listActive(offices) {
      return officeRows(offices, true).map((r) => ({ office: r.office, designation: r.designation ?? "", memberIds: r.member ? [r.member] : [] }));
    },
    async listAllMembers(offices) {
      return officeRows(offices, false).map((r) => ({ id: r.id, office: r.office, memberIds: r.member ? [r.member] : [] }));
    },
  };

  const matches: MatchesRepo = {
    async getById(id) {
      const m = s.matches.find((x) => x.id === id);
      return m ? clone(m) : null;
    },
    async update(id, patch) {
      const m = s.matches.find((x) => x.id === id);
      if (!m) throw new Error(`No match ${id}`);
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) (m as unknown as Record<string, unknown>)[key] = clone(value);
      }
    },
    // apply_squad_changes: adds and removes applied to the squad as it is
    // now, the version bumped per real change, and a derby add taken off the
    // other side. No change history is kept, so it never reports a conflict;
    // spy on it to return one.
    async applySelectionChanges(id, change) {
      const m = s.matches.find((x) => x.id === id);
      if (!m) throw new HttpError(`No match ${id}`, 404, "NOT_FOUND");
      const [listKey, otherKey, versionKey, otherVersionKey] = change.side === "home"
        ? (["selectedPlayersHome", "selectedPlayersAway", "selectionVersionHome", "selectionVersionAway"] as const)
        : (["selectedPlayersAway", "selectedPlayersHome", "selectionVersionAway", "selectionVersionHome"] as const);
      const before = m[listKey] ?? [];
      const removed = before.filter((pid) => change.remove.includes(pid));
      const added = [...new Set(change.add)].filter((pid) => !before.includes(pid));
      if (added.length === 0 && removed.length === 0) {
        return { status: "unchanged", version: m[versionKey] ?? 0, selected: [...before] };
      }
      m[listKey] = [...before.filter((pid) => !removed.includes(pid)), ...added];
      m[versionKey] = (m[versionKey] ?? 0) + 1;
      let otherVersion: number | null = null;
      const other = m[otherKey] ?? [];
      if (other.some((pid) => added.includes(pid))) {
        m[otherKey] = other.filter((pid) => !added.includes(pid));
        otherVersion = m[otherVersionKey] = (m[otherVersionKey] ?? 0) + 1;
      }
      return { status: "ok", version: m[versionKey], otherVersion, added, removed, selected: [...m[listKey]] };
    },
    async listForSeason(season) {
      return s.matches.filter((m) => !season || m.season === season).map(clone);
    },
    async listScheduled() {
      return s.matches.filter((m) => m.matchStatus === "Scheduled").map(clone);
    },
    async listPlayedForSeasons(seasons) {
      return s.matches.filter((m) => m.matchStatus === "Played" && seasons.includes(m.season ?? "")).map(clone);
    },
    async listResultsForSeasons(seasons) {
      return s.matches
        .filter((m) => m.matchStatus === "Played" && seasons.includes(m.season ?? ""))
        .map((m) => ({
          id: m.id, matchDate: m.matchDate, season: m.season, competitionType: m.competitionType,
          homeTeam: m.homeTeam, homeTeamScore: m.homeTeamScore, awayTeam: m.awayTeam, awayTeamScore: m.awayTeamScore,
          venue: m.venue, matchStatus: m.matchStatus,
        }) as Match);
    },
  };

  const matchCards: MatchCardsRepo = {
    async listForSeason(season, opts = {}) {
      return s.matchCards
        .filter((c) => (!season || c.season === season) && (!opts.cardedOnly || (c.cards?.length ?? 0) > 0))
        .map(clone);
    },
  };

  const toException = (id: string, m: Match, playerId: string, status: string, notes: string | undefined, by: string): FakeException => ({
    id,
    player: [playerId],
    match: [m.id],
    availabilityStatus: status as FakeException["availabilityStatus"],
    note: notes ?? "",
    // The view reads the season from the match.
    season: m.season ?? "",
    updatedAt: new Date().toISOString(),
    updatedBy: by,
  });
  /** set_availability's errors, as PostgREST reports them. */
  const pgError = (status: number, code: string, message: string) =>
    new SupabaseError(`Supabase POST rpc/set_availability failed (${status}): ${message}`, status, code);
  /** A team's rank as set_availability reads it: Active teams only, a blank or 0 rank is 99. */
  const activeRank = (name: string | undefined) => {
    const t = s.teams.find((x) => x.active === true && !!name && x.teamName === name);
    return t ? t.teamRank || UNRANKED_TEAM_RANK : undefined;
  };
  /**
   * set_availability (migration 20261007141003), in memory: the same checks,
   * the same store-or-delete decision through the TypeScript rule engine
   * (needsExplicitAvailable), all or nothing.
   */
  const setAnswer: AvailabilityExceptionsRepo["set"] = async ({ playerId, matchIds, status, notes, updatedById }) => {
    if (!["Available", "Maybe", "Unavailable"].includes(status)) throw pgError(400, "22023", "status must be Available, Maybe or Unavailable");
    if (matchIds.some((id) => !id)) throw pgError(400, "22023", "matchIds[] must be record ids");
    const p = findPerson(playerId);
    if (!p || p.active !== true) throw pgError(404, "P0002", "Player not found or inactive");
    const by = updatedById || playerId;
    if (!findPerson(by)) throw pgError(404, "P0002", `No person ${by}`);
    const playerRank = activeRank(p.registeredTeam) ?? UNRANKED_TEAM_RANK;
    // In api_id order, as availability_rule_status breaks its last ties.
    const rules = s.availabilityRules.filter((r) => (r.player ?? []).includes(playerId)).sort((a, b) => a.id.localeCompare(b.id));

    const rows = [...s.availabilityExceptions];
    const kept: AvailabilityOutcome["results"] = [];
    const created: AvailabilityOutcome["results"] = [];
    const before: AvailabilityOutcome["before"] = [];
    const seasons: string[] = [];
    for (const matchId of [...new Set(matchIds)]) {
      const m = s.matches.find((x) => x.id === matchId);
      if (m?.season && !seasons.includes(m.season)) seasons.push(m.season);
      const i = m ? rows.findIndex((e) => e.player?.[0] === playerId && e.match?.[0] === matchId) : -1;
      if (i >= 0) before.push({ matchId, exceptionId: rows[i].id, status: rows[i].availabilityStatus ?? "" });
      let needed = false;
      if (status === "Available" && m && m.matchStatus === "Scheduled") {
        const sides = [m.homeTeam, m.awayTeam].map(activeRank).filter((r): r is number => r !== undefined);
        const fixtureRank = sides.length ? Math.min(...sides) : UNRANKED_TEAM_RANK;
        needed = needsExplicitAvailable(
          rules,
          { date: hkDateKey(m.matchDate), isPlayUp: fixtureRank < playerRank, isSupport: fixtureRank > playerRank },
          { optInOnly: p.optInOnly === true },
        );
      }
      if (status === "Available" && !needed) {
        if (i >= 0) rows.splice(i, 1);
        kept.push({ matchId, exceptionId: null });
      } else if (!m) {
        throw pgError(404, "P0002", `No match ${matchId}`);
      } else if (i >= 0) {
        rows[i] = toException(rows[i].id, m, playerId, status, notes, by);
        kept.push({ matchId, exceptionId: rows[i].id });
      } else {
        const id = fakeUuid();
        rows.push(toException(id, m, playerId, status, notes, by));
        created.push({ matchId, exceptionId: id });
      }
    }
    // One transaction: nothing changes unless every answer went through.
    s.availabilityExceptions.splice(0, s.availabilityExceptions.length, ...rows);
    return { updated: kept.length + created.length, results: [...kept, ...created], before, seasons };
  };
  const availabilityExceptions: AvailabilityExceptionsRepo = {
    // The targeted reads select id, player, match, status and note only.
    async listForMatches(matchIds) {
      return s.availabilityExceptions
        .filter((e) => matchIds.includes(e.match?.[0] ?? ""))
        .map(({ id, player, match, availabilityStatus, note }) => clone({ id, player, match, availabilityStatus, note, season: "", updatedAt: "" }));
    },
    async listForPlayer(playerId, matchIds) {
      return s.availabilityExceptions
        .filter((e) => e.player?.[0] === playerId && matchIds.includes(e.match?.[0] ?? ""))
        .map(({ id, player, match, availabilityStatus, note }) => clone({ id, player, match, availabilityStatus, note, season: "", updatedAt: "" }));
    },
    async listForSeasons(seasons) {
      return s.availabilityExceptions
        .filter((e) => seasons.includes(e.season ?? ""))
        .map(({ updatedBy: _by, ...e }) => clone(e));
    },
    set: setAnswer,
    async setForDate({ playerId, date, status, notes }) {
      const ids = s.matches
        .filter((m) => m.matchStatus === "Scheduled" && hkDateKey(m.matchDate) === date)
        .filter((m) => activeRank(m.homeTeam) !== undefined || activeRank(m.awayTeam) !== undefined)
        .map((m) => m.id)
        .sort();
      if (ids.length === 0) return { updated: 0, results: [], before: [], seasons: [] };
      return setAnswer({ playerId, matchIds: ids, status, notes });
    },
  };

  const availabilityRules: AvailabilityRulesRepo = {
    async listAll() {
      return s.availabilityRules.map(clone);
    },
    async create(rule) {
      const row: AvailabilityRule = {
        id: fakeUuid(),
        player: [rule.playerId],
        ruleType: rule.ruleType,
        availability: rule.availability,
        active: true,
        startDate: rule.startDate || "",
        endDate: rule.endDate || "",
        notes: rule.notes || "",
        lastModified: new Date().toISOString(),
      };
      s.availabilityRules.push(row);
      return clone(row);
    },
    async delete(id) {
      removeWhere(s.availabilityRules, (r) => r.id === id);
    },
  };

  const abilityGroups: AbilityGroupsRepo = {
    async list() {
      return s.abilityGroups.map(clone);
    },
    async saveCapacities(capacities) {
      for (const [group, capacity] of Object.entries(capacities) as [AbilityGroupConfiguration["group"], number][]) {
        const row = s.abilityGroups.find((g) => g.group === group);
        if (row) row.capacity = capacity;
        else s.abilityGroups.push({ id: fakeUuid(), group, capacity, isResidual: false });
      }
    },
  };

  const rankingEvents: RankingEventsRepo = {
    async create(events) {
      for (const e of events) s.rankingEvents.push({ id: fakeUuid(), ...clone(e) });
    },
    async listNewestFirst() {
      return [...s.rankingEvents]
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || a.id.localeCompare(b.id))
        .map(clone);
    },
  };

  const membershipEvents: MembershipEventsRepo = {
    async record(event) {
      s.membershipEvents.push(clone(event));
    },
  };

  const commitments: CommitmentsRepo = {
    async listReviewBoard() {
      const today = new Date().toISOString().slice(0, 10);
      return s.commitments
        .filter((c) => {
          const start = scalar(c.periodStart);
          const end = scalar(c.periodEnd);
          return typeof start === "string" && typeof end === "string" && start < addDays(today, 2) && end > addDays(REVIEWS_FROM, -2);
        })
        .map((c) => commitmentRow(c, COMMITMENT_FIELDS));
    },
    async getNotifyState(id) {
      const c = s.commitments.find((x) => x.id === id);
      return c ? commitmentRow(c, NOTIFY_FIELDS) : null;
    },
    async setNotifyNow(id) {
      // On Supabase this starts the review (start_review) and emails the
      // member; here it ticks notifyNow, and a second start is refused the
      // same way.
      const c = s.commitments.find((x) => x.id === id);
      if (!c || c.notifyNow === true) throw new HttpError("This review has already been started.", 409, "ALREADY_STARTED");
      c.notifyNow = true;
    },
    async listReviewsAtStages(stages) {
      return s.commitments
        .filter((c) => stages.includes(c.reviewProgress as string))
        .map((c) => commitmentRow(c, REVIEW_TASK_FIELDS));
    },
  };

  const suspensions: SuspensionsRepo = {
    async listOpen() {
      return s.suspensions.map(clone);
    },
  };

  return {
    people, teams, officers, matches, matchCards, availabilityExceptions, availabilityRules, abilityGroups, rankingEvents,
    membershipEvents, commitments, suspensions,
  };
}

/** Wraps every method so the call is logged. */
/** A repository method that only reads; anything else is a write. */
const READ_METHOD = /^(get|list|find|count|read|search|load|has|is)/;

/**
 * The fakes' cache versions (cache_versions): one counter for every table,
 * moved by every repository write, as the database's triggers move theirs.
 * So a value cached under the versions is rebuilt after any write.
 */
let fakeVersion = 1;
export function fakeVersions(): CacheVersions {
  return parseCacheVersions(Object.fromEntries(CACHE_VERSION_KEYS.map((k) => [k, fakeVersion])));
}
function onWrite(): void {
  fakeVersion++;
  noteRequestWrite();
}

function recorded<T extends object>(repo: RepoName, target: T, calls: RepoCall[], written?: () => void): T {
  const out: Record<string, unknown> = {};
  for (const [method, fn] of Object.entries(target)) {
    out[method] = (...raw: unknown[]) => {
      // An iterable argument (a Set, a Map's keys) is read once, into an array, for both the log and the call.
      const args = raw.map((a) =>
        a && typeof a === "object" && !Array.isArray(a) && Symbol.iterator in a ? [...(a as Iterable<unknown>)] : a,
      );
      let logged: unknown[];
      try {
        logged = clone(args);
      } catch {
        logged = args;
      }
      calls.push({ repo, method, args: logged });
      const result = (fn as (...a: unknown[]) => unknown)(...args);
      if (written && !READ_METHOD.test(method)) {
        // After the write lands, as a database write would.
        return Promise.resolve(result).then((value) => {
          written();
          return value;
        });
      }
      return result;
    };
  }
  return out as T;
}

// ── Installing ───────────────────────────────────────────────────────────

/**
 * Replaces every repository accessor (people(env), teams(env), ...) with the
 * in-memory repositories, seeded from `seed`. Returns the state, the repos
 * and the call log. Call restore() (or vi.restoreAllMocks()) afterwards;
 * useFakeRepos() does both for a whole file.
 */
export function installFakeRepos(seed: Partial<FakeState> = {}): FakeReposHandle {
  const state = emptyState();
  const calls: RepoCall[] = [];
  // The repositories read `state` through this indirection, so reset() can
  // swap the arrays without re-installing.
  const live = buildRepos(state);
  const repos = Object.fromEntries(
    Object.entries(live).map(([name, repo]) => [name, recorded(name as RepoName, repo as object, calls, onWrite)]),
  ) as unknown as FakeRepos;

  const spies = [
    vi.spyOn(peopleModule, "people").mockImplementation(() => repos.people),
    vi.spyOn(teamsModule, "teams").mockImplementation(() => repos.teams),
    vi.spyOn(officersModule, "officers").mockImplementation(() => repos.officers),
    vi.spyOn(matchesModule, "matches").mockImplementation(() => repos.matches),
    vi.spyOn(matchCardsModule, "matchCards").mockImplementation(() => repos.matchCards),
    vi.spyOn(exceptionsModule, "availabilityExceptions").mockImplementation(() => repos.availabilityExceptions),
    vi.spyOn(rulesModule, "availabilityRules").mockImplementation(() => repos.availabilityRules),
    vi.spyOn(abilityGroupsModule, "abilityGroups").mockImplementation(() => repos.abilityGroups),
    vi.spyOn(rankingEventsModule, "rankingEvents").mockImplementation(() => repos.rankingEvents),
    vi.spyOn(membershipEventsModule, "membershipEvents").mockImplementation(() => repos.membershipEvents),
    vi.spyOn(commitmentsModule, "commitments").mockImplementation(() => repos.commitments),
    vi.spyOn(suspensionsModule, "suspensions").mockImplementation(() => repos.suspensions),
    // season_context: assembled from the same repositories, so their call logs still show the reads.
    vi.spyOn(seasonDataModule, "seasonData").mockImplementation(() => ({ load: (season: string, player?: string) => fakeSeasonData(repos, season, player) })),
    // auth.ts reads the signed-in person through auth_context: answered from the same state.
    vi.spyOn(authContextModule, "authContexts").mockImplementation(() => ({ load: async (email: string) => authContextFrom(state, email) })),
    // A request without sign-in reads the versions: the fakes' counter.
    vi.spyOn(cacheVersionsModule, "readCacheVersions").mockImplementation(async () => fakeVersions()),
  ];

  const handle: FakeReposHandle = {
    state,
    repos,
    calls,
    callsTo: (repo, method) => calls.filter((c) => c.repo === repo && (!method || c.method === method)),
    reset(next = {}) {
      calls.length = 0;
      const fresh = emptyState();
      for (const key of Object.keys(fresh) as RepoName[]) {
        // Same object, new arrays: tests that hold `state` see the reset.
        (state as unknown as Record<string, unknown[]>)[key] = (next[key] ?? fresh[key]) as unknown[];
      }
    },
    restore() {
      for (const spy of spies) spy.mockRestore();
    },
    signedIn(email, overrides = {}) {
      const ctx = authContextFrom(state, email);
      const person = ctx.person ?? { id: "", uuid: "", email };
      return signedIn({
        email,
        personId: person.id,
        personUuid: person.uuid,
        person,
        captainTeams: ctx.captainTeams,
        socialSecretaryTeams: ctx.socialSecretaryTeams,
        offices: ctx.offices,
        umpire: ctx.umpire,
        ...overrides,
      });
    },
  };
  handle.reset(seed);
  return handle;
}

/**
 * installFakeRepos() for every test in the file: installed before each test
 * (seeded by `seed()`, if given) and restored after it. The handle is the
 * same object throughout, so a file can keep it in a const.
 *
 *   const db = useFakeRepos(() => ({ people: [player({ id: ALICE })] }));
 */
export function useFakeRepos(seed?: () => Partial<FakeState>): FakeReposHandle {
  let current: FakeReposHandle | null = null;
  const proxy = {} as FakeReposHandle;
  const forward = (key: keyof FakeReposHandle) =>
    Object.defineProperty(proxy, key, {
      get: () => {
        if (!current) throw new Error("useFakeRepos(): the fakes are installed in beforeEach; use the handle inside a test or hook");
        return current[key];
      },
    });
  (["state", "repos", "calls", "callsTo", "reset", "restore", "signedIn"] as const).forEach(forward);
  beforeEach(() => {
    current = installFakeRepos(seed?.());
  });
  afterEach(() => {
    current?.restore();
    current = null;
  });
  return proxy;
}

// ── auth_context ─────────────────────────────────────────────────────────

const OFFICE_ROLES: Record<Office, string> = {
  membershipOfficer: "membership_officer",
  sectionChair: "section_chair",
  sectionCaptain: "section_captain",
  sponsor: "sponsor",
  kitConvenor: "kit_convenor",
  hockeyConvenor: "hockey_convenor",
  assistantDirector: "assistant_director",
  umpireCoordinator: "umpire_coordinator",
};
const OFFICE_ORDER: Office[] = [
  "membershipOfficer", "sectionChair", "sectionCaptain", "kitConvenor", "hockeyConvenor", "assistantDirector", "umpireCoordinator", "sponsor",
];

/**
 * What auth_context(p_email) returns for the seeded state, by the SQL's
 * rules (supabase/migrations/*_auth_context.sql): the person by email
 * (Active first), Teams links over ALL teams in id order, captaincies of
 * Active teams, Active offices in office order. A seeded person's `uuid`
 * defaults to their id; `umpire` is read from the row (default false).
 */
export function authContextFrom(s: FakeState, email: string): AuthContext {
  const want = normalizeEmail(email);
  const rows = s.people.filter((p) => typeof p.email === "string" && normalizeEmail(p.email) === want);
  const p = rows.find((r) => r.active) ?? rows[0];
  const versions = fakeVersions();
  if (!p) {
    return {
      person: null, isTeamCoach: false, coachTeams: [], teamSectionCaptain: false, allTeamNames: [], captainTeams: [],
      socialSecretaryTeams: [], offices: [], umpire: false, versions,
    };
  }
  const teams = [...s.teams].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const offices = s.officers
    .filter((o) => o.status === "Active" && o.member === p.id)
    .sort((a, b) => OFFICE_ORDER.indexOf(a.office) - OFFICE_ORDER.indexOf(b.office) || (a.id < b.id ? -1 : 1))
    .map((o) => ({ role: OFFICE_ROLES[o.office], office: o.office === "sponsor" ? null : o.office, designation: o.designation ?? "" }));
  const teamSectionCaptain = teams.some((t) => (t.sectionCaptain ?? []).includes(p.id));
  const { crm: _crm, ...player } = p;
  const extra = p as FakePerson & { uuid?: string; umpire?: boolean };
  const profileUpdatedAt = (p.crm as Record<string, unknown> | undefined)?.profileUpdatedAt;
  return {
    person: {
      ...player,
      uuid: extra.uuid ?? p.id,
      ...(typeof profileUpdatedAt === "string" ? { profileUpdatedAt } : {}),
    },
    isTeamCoach: teams.some((t) => (t.coach ?? []).includes(p.id)),
    coachTeams: teams.filter((t) => (t.coach ?? []).includes(p.id) && t.teamName).map((t) => t.teamName!),
    teamSectionCaptain,
    allTeamNames:
      teamSectionCaptain || offices.some((o) => o.office === "assistantDirector")
        ? teams.filter((t) => t.teamName).map((t) => t.teamName!)
        : [],
    captainTeams: teams.filter((t) => t.active && (t.teamCaptain ?? []).includes(p.id)).map((t) => t.teamName || ""),
    socialSecretaryTeams: [],
    offices,
    umpire: extra.umpire === true,
    versions,
  };
}

// ── season_context ───────────────────────────────────────────────────────

/**
 * What season_context(p_season, p_player) returns for the seeded state, by
 * the SQL's rules (supabase/migrations/*_season_context.sql): the season's
 * matches, cards and answers; last season's Played or carded matches and
 * carded cards; the open suspensions; a per-match summary of the teams on
 * its cards. For a player: their cards plus every card with a goal or a
 * card, their answers (with note and id) plus those of anyone selected (without).
 */
export async function fakeSeasonData(repos: FakeRepos, season: string, player?: string): Promise<SeasonData> {
  const m = /^(\d{4})-(\d{4})$/.exec(season);
  const prev = m ? `${Number(m[1]) - 1}-${m[1]}` : "";
  const [matches, allCards, allExceptions, prevCards, prevAll, suspensions] = await Promise.all([
    repos.matches.listForSeason(season),
    repos.matchCards.listForSeason(season),
    repos.availabilityExceptions.listForSeasons([season]),
    prev ? repos.matchCards.listForSeason(prev, { cardedOnly: true }) : Promise.resolve([] as MatchCard[]),
    prev ? repos.matches.listForSeason(prev) : Promise.resolve([] as Match[]),
    repos.suspensions.listOpen(),
  ]);
  const cardedPrev = new Set(prevCards.map((c) => c.match?.[0]));
  const previousMatches = prevAll.filter((x) => (x.matchStatus || "").toLowerCase() === "played" || cardedPrev.has(x.id));
  const selected = new Set(matches.flatMap((x) => [...(x.selectedPlayersHome ?? []), ...(x.selectedPlayersAway ?? [])].map((p) => `${p}:${x.id}`)));
  const cardSummary = new Map<string, { teams: string[]; count: number }>();
  for (const c of allCards) {
    const id = c.match?.[0];
    if (!id) continue;
    const entry = cardSummary.get(id) ?? { teams: [], count: 0 };
    entry.count++;
    if (c.team && !entry.teams.includes(c.team)) entry.teams.push(c.team);
    cardSummary.set(id, entry);
  }
  const cards = player
    ? allCards.filter((c) => c.player?.[0] === player || (c.goals ?? 0) > 0 || (c.cards?.length ?? 0) > 0)
    : allCards;
  const exceptions = player
    ? allExceptions
        .filter((e) => e.player?.[0] === player || selected.has(`${e.player?.[0]}:${e.match?.[0]}`))
        .map((e) => (e.player?.[0] === player ? e : { ...e, id: "", note: "" }))
    : allExceptions;
  return { matches, cards, exceptions, previousMatches, previousCards: prevCards, suspensions, cardSummary };
}
