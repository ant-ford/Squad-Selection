import { normalizeEmail } from "../../shared/normalizeEmail";
import type { Env } from "./env";
import { getCached, getShared, invalidateCache, invalidateCachePrefix, invalidateShared, rawReadTtl } from "./cache";
import { inBackground } from "./requestContext";
import { people } from "./data/people";
import { teams as teamsRepo } from "./data/teams";
import { officers, type Office } from "./data/officers";
import { backendFor } from "./data/backend";
import { availabilityExceptions } from "./data/availabilityExceptions";
import type { Player, Team, AvailabilityException } from "../../shared/schema/domainTypes";

export type { Office };

export interface ReferenceData {
  players: Player[];
  teams: Team[];
  teamRankMap: Record<string, number>;
  teamNames: string[];
}

/** Rank sentinel for a team with no Team Rank set: sorts after every real rank. */
export const UNRANKED_TEAM_RANK = 99;

export async function getReferenceData(env: Env): Promise<ReferenceData> {
  return getShared<ReferenceData>(env, "club-reference", async () => {
    const [teams, players] = await Promise.all([
      teamsRepo(env).listActive(),
      people(env).listActive(),
    ]);

    const teamRankMap: Record<string, number> = {};
    for (const t of teams) {
      if (t.teamName) teamRankMap[t.teamName] = t.teamRank ?? UNRANKED_TEAM_RANK;
    }

    return {
      players,
      teams,
      teamRankMap,
      teamNames: teams.map((t) => t.teamName || ""),
    };
  }, rawReadTtl(env, REFERENCE_TTL_MS));
}

const REFERENCE_TTL_MS = 10 * 60 * 1000;

/**
 * Coach / Section Captain relationships across ALL team records â€” including
 * teams currently marked inactive. Authorization must depend on the person's
 * role, not on whether a team record happens to be inactive, so this lookup
 * deliberately skips the "{Active}=TRUE()" filter used by getReferenceData().
 */
export interface TeamCoachLinks {
  coachIds: string[];
  sectionCaptainIds: string[];
  /**
   * Team names each person coaches (Teams.Coach link), keyed by People
   * record id. A plain object rather than a Map so it survives the KV
   * round trip (JSON turns a Map into {} without complaint).
   */
  coachTeamNamesByPersonId: Record<string, string[]>;
  /** Every team name, regardless of Active status - a Section Captain sees the whole section. */
  allTeamNames: string[];
}

/**
 * Shared across isolates: every authenticated request needs this, and on a
 * cold isolate it was one more Teams read before any route could start.
 */
export async function getTeamCoachLinks(env: Env): Promise<TeamCoachLinks> {
  return getShared<TeamCoachLinks>(
    env,
    "team-coach-links",
    async () => {
      const allTeams = await teamsRepo(env).listAll();
      const coachIds = new Set<string>();
      const sectionCaptainIds = new Set<string>();
      const coachTeamNamesByPersonId: Record<string, string[]> = {};
      const allTeamNames: string[] = [];
      for (const team of allTeams) {
        const teamName = team.teamName || "";
        if (teamName) allTeamNames.push(teamName);
        for (const id of team.coach ?? []) {
          if (typeof id !== "string") continue;
          coachIds.add(id);
          if (teamName) (coachTeamNamesByPersonId[id] ??= []).push(teamName);
        }
        for (const id of team.sectionCaptain ?? []) {
          if (typeof id === "string") sectionCaptainIds.add(id);
        }
      }
      return {
        coachIds: [...coachIds],
        sectionCaptainIds: [...sectionCaptainIds],
        coachTeamNamesByPersonId,
        allTeamNames,
      };
    },
    rawReadTtl(env, REFERENCE_TTL_MS),
  );
}

/*
 * Office (from data/officers.ts, re-exported above) says which officer
 * table a role comes from.
 *
 * "sectionCaptain" is a row in the Section Captains TABLE. That is not the
 * same thing as AuthorizedUser.isSectionCaptain, which comes from the
 * Teams.Section Captain link and grants coach access to every team. The
 * officers' sections are gated on the table (owner decision, 2026-09-25).
 */

/** One Active office held, e.g. { office: "sectionChair", designation: "Chairman" }. */
export interface OfficerRole {
  office: Office;
  /** The row's Designation. Empty when the row has none. */
  designation: string;
}

/**
 * Offices held, keyed by People record id, from the Membership Officers,
 * Section Chairs and Section Captains tables. Only Active rows count: a Retired row is history,
 * not access.
 *
 * Officers sign in with their personal email, which is on their People
 * record, and each officer row links to that record through Member. So this
 * is matched on the record id, like the Teams coach links, and never on the
 * officer row's own Email field.
 */
export interface OfficerLinks {
  rolesByPersonId: Record<string, OfficerRole[]>;
}

export const OFFICER_LINKS_KEY = "officer-links";

/**
 * The applicant records behind the membership board and Insights
 * (membership.ts). Declared here rather than there so airtableWebhook.ts can
 * name it without a circular import. v2: holds rows keyed by the field map's
 * keys (data/rows.ts), not raw Airtable records.
 */
export const MEMBERSHIP_RECORDS_KEY = "membership-records:v2";

/** The chairman's email-list directory (chairman.ts); declared here for the same reason. */
export const CHAIRMAN_DIRECTORY_KEY = "chairman-directory";

/**
 * The Commitments rows behind the Statements board (statements.ts); declared
 * here for the same reason. v2: rows, not raw Airtable records.
 */
export const STATEMENT_RECORDS_KEY = "statement-records:v2";

/** Who the New Joiner and Statements processes are waiting on (myTasks.ts); declared here for the same reason. */
export const WAITING_ON_KEY = "waiting-on";

/** The current season's Stats summary (clubStats.ts); past seasons keep their own keys. */
export const STATS_CURRENT_KEY = "stats-summary:current";

export async function getOfficerLinks(env: Env): Promise<OfficerLinks> {
  return getShared<OfficerLinks>(
    env,
    OFFICER_LINKS_KEY,
    async () => {
      // The Kit Convenor opens the kit screens, the Hockey Convenor league
      // registration requests and the Assistant Director of Hockey every
      // team's coach screens, which exist only on Supabase.
      const offices: Office[] = ["membershipOfficer", "sectionChair", "sectionCaptain"];
      if (backendFor(env, "officers") === "supabase") offices.push("kitConvenor", "hockeyConvenor", "assistantDirector");
      const rows = await officers(env).listActive(offices);
      const rolesByPersonId: Record<string, OfficerRole[]> = {};
      for (const { office, designation, memberIds } of rows) {
        for (const id of memberIds) (rolesByPersonId[id] ??= []).push({ office, designation });
      }
      return { rolesByPersonId };
    },
    rawReadTtl(env, REFERENCE_TTL_MS),
  );
}

export async function getActivePlayers(env: Env): Promise<Player[]> {
  return people(env).listActive();
}

/**
 * Without a webhook an access decision follows an Airtable correction
 * within a minute; with one, a People edit drops these entries as it
 * happens, and the TTL is capped at five minutes as a backstop.
 */
const PLAYER_BY_EMAIL_TTL_MS = 60 * 1000;
const PLAYER_BY_EMAIL_MAX_TTL_MS = 5 * 60 * 1000;

function playerByEmailKey(email: string): string {
  return `player-by-email:${normalizeEmail(email)}`;
}

/**
 * Drops the lookup in this isolate at once and, given `env`, in KV after
 * the response - a rank change is already several Airtable writes long.
 */
export function invalidatePlayerByEmail(email: string, env?: Env): void {
  const key = playerByEmailKey(email);
  invalidateCache(key);
  if (env?.CACHE) void inBackground(() => invalidateShared(env, [key]));
}

/**
 * Fan-out for a write that changes club reference data (team rosters,
 * coach links, ability/rank fields) - every read built on top of
 * getReferenceData/getTeamCoachLinks or a per-match player list would
 * otherwise keep serving the pre-write snapshot.
 *
 * The reference reads are shared, so the KV copies go too - otherwise every
 * other isolate kept serving the pre-write roster for the rest of the TTL.
 */
export async function invalidateReferenceData(env: Env): Promise<void> {
  invalidateCachePrefix("players-for-match:");
  await invalidateShared(env, ["club-reference", "team-coach-links"]);
}

/**
 * People-record lookup by email, shared across isolates. Every caller,
 * including the authorization path in worker/src/auth.ts, reuses the entry;
 * on a cold isolate this used to be a formula scan of the whole People
 * table (every field of it) before any route could begin. Pass
 * { fresh: true } to bypass the cache for a live read.
 */
export async function getPlayerByEmail(
  env: Env,
  email: string,
  opts?: { fresh?: boolean },
): Promise<Player | null> {
  if (opts?.fresh) {
    return lookupPlayerByEmail(env, email);
  }
  return getShared<Player | null>(
    env,
    playerByEmailKey(email),
    () => lookupPlayerByEmail(env, email),
    Math.min(rawReadTtl(env, PLAYER_BY_EMAIL_TTL_MS), PLAYER_BY_EMAIL_MAX_TTL_MS),
  );
}

async function lookupPlayerByEmail(env: Env, email: string): Promise<Player | null> {
  return people(env).findByEmail(email);
}

/**
 * Availability exceptions for one or more seasons.
 *
 * Cached for five minutes, which is fine for the aggregate views but NOT for
 * a player looking at their own answer. The cache lives in the memory of one
 * Worker isolate, and Cloudflare runs many: a write invalidates the cache on
 * whichever isolate served it, and says nothing to the others. So a player
 * could set Maybe, tap Available, and have the next request land on an
 * isolate still holding a five-minute-old copy - which showed Maybe again.
 * From their side the status simply would not change.
 *
 * Pass { fresh: true } where read-your-own-write matters. It skips the cache
 * entirely rather than trying to invalidate across isolates, which an
 * in-memory cache cannot do.
 */
export async function getExceptionsForSeasons(
  env: Env,
  seasons: string[],
  opts?: { fresh?: boolean },
): Promise<AvailabilityException[]> {
  const uniqueSeasons = [...new Set(seasons.filter(Boolean))].sort();
  const cacheKey = `exceptions:${uniqueSeasons.join(",") || "none"}`;
  const load = async () => {
    return availabilityExceptions(env).listForSeasons(uniqueSeasons);
  };
  if (opts?.fresh) return load();
  return getShared<AvailabilityException[]>(env, cacheKey, load, rawReadTtl(env, EXCEPTIONS_TTL_MS));
}

const EXCEPTIONS_TTL_MS = 5 * 60 * 1000;

export { invalidateCache };
