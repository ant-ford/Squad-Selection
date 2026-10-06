import { normalizeEmail } from "../../shared/normalizeEmail";
import type { Env } from "./env";
import { getShared, invalidateCache, invalidateCachePrefix, invalidateShared } from "./cache";
import { inBackground } from "./requestContext";
import { people } from "./data/people";
import { teams as teamsRepo } from "./data/teams";
import type { Office } from "./data/officers";
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
  }, REFERENCE_TTL_MS);
}

const REFERENCE_TTL_MS = 10 * 60 * 1000;

/** The Active teams alone (~3 KB), for screens that need no players list. */
export async function getActiveTeams(env: Env): Promise<Team[]> {
  return getShared<Team[]>(env, "active-teams", () => teamsRepo(env).listActive(), REFERENCE_TTL_MS);
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
 * The applicant records behind the membership board and Insights
 * (membership.ts). Declared here rather than there so invalidation.ts can
 * name it without a circular import. v2: holds rows keyed by column name
 * (data/rows.ts), not raw Airtable records.
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

/** An access decision follows a correction made outside the Worker within a minute. */
const PLAYER_BY_EMAIL_TTL_MS = 60 * 1000;

function playerByEmailKey(email: string): string {
  return `player-by-email:${normalizeEmail(email)}`;
}

/**
 * Drops the lookup in this isolate at once, and the rest of the clearing
 * after the response when `env` has a cache binding.
 */
export function invalidatePlayerByEmail(email: string, env?: Env): void {
  const key = playerByEmailKey(email);
  invalidateCache(key);
  if (env?.CACHE) void inBackground(() => invalidateShared(env, [key]));
}

/**
 * Fan-out for a write that changes club reference data (team rosters,
 * coach links, ability/rank fields) - every read built on top of
 * getReferenceData/getActiveTeams or a per-match player list would
 * otherwise keep serving the pre-write snapshot.
 */
export async function invalidateReferenceData(env: Env): Promise<void> {
  invalidateCachePrefix("players-for-match:");
  await invalidateShared(env, ["club-reference", "active-teams"]);
}

/**
 * People-record lookup by email, cached. Every caller, including the
 * authorization path in worker/src/auth.ts, reuses the entry. Pass
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
    PLAYER_BY_EMAIL_TTL_MS,
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
  return getShared<AvailabilityException[]>(env, cacheKey, load, EXCEPTIONS_TTL_MS);
}

const EXCEPTIONS_TTL_MS = 5 * 60 * 1000;

export { invalidateCache };
