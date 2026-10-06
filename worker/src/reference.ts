import { normalizeEmail } from "../../shared/normalizeEmail";
import type { Env } from "./env";
import { getVersioned, invalidateCache, invalidateShared } from "./cache";
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
  return getVersioned<ReferenceData>(env, "club-reference", ["people", "teams", "team_people"], async () => {
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
  return getVersioned<Team[]>(env, "active-teams", ["teams", "team_people"], () => teamsRepo(env).listActive(), REFERENCE_TTL_MS);
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
 * Was the fan-out after a write to club reference data. The reference
 * data, the teams and the per-match player lists are now kept under the
 * cache versions (cache.ts getVersioned), which the write itself moves, so
 * there is nothing to drop. Kept, empty, for availability.ts until the
 * set_availability work replaces that path.
 */
export async function invalidateReferenceData(_env: Env): Promise<void> {}

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
  return getVersioned<Player | null>(env, playerByEmailKey(email), ["people"], () => lookupPlayerByEmail(env, email));
}

async function lookupPlayerByEmail(env: Env, email: string): Promise<Player | null> {
  return people(env).findByEmail(email);
}

/**
 * Availability exceptions for one or more seasons.
 *
 * Kept under the availability_exceptions and matches versions (cache.ts
 * getVersioned). It used to be a plain five-minute copy per isolate, which
 * a write cleared only on the isolate that took it: a player could tap
 * Available and be shown Maybe again by another isolate. A tap now moves
 * the version, so every isolate reads afresh on its next request, and the
 * player sees their own answer.
 *
 * { fresh: true } still skips the cache, for a write path that must read
 * what is there this instant.
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
  // The season of an answer is its match's: both tables' versions.
  return getVersioned<AvailabilityException[]>(env, cacheKey, ["availability_exceptions", "matches"], load, EXCEPTIONS_TTL_MS);
}

const EXCEPTIONS_TTL_MS = 5 * 60 * 1000;

export { invalidateCache };
