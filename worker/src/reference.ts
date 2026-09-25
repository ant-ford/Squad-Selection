import { airtableFindAll, escapeFormulaValue } from "./airtable";
import { normalizeEmail } from "../../shared/normalizeEmail";
import type { Env } from "./env";
import { getCached, getShared, invalidateCache, invalidateCachePrefix, invalidateShared, rawReadTtl } from "./cache";
import { inBackground } from "./requestContext";
import { TABLES } from "../../shared/schema/tableNames";
import { PEOPLE_FIELDS, TEAMS_FIELDS, AVAILABILITYEXCEPTIONS_FIELDS, OFFICER_FIELDS } from "../../shared/schema/fieldMaps";
import { mapPlayer } from "../../shared/mappers/playerMapper";
import { mapTeam } from "../../shared/mappers/teamMapper";
import { mapAvailability } from "../../shared/mappers/availabilityMapper";
import type { Player, Team, AvailabilityException } from "../../shared/schema/domainTypes";

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
    const [teamRecords, playerRecords] = await Promise.all([
      airtableFindAll(env, TABLES.team, "{Active}=TRUE()"),
      airtableFindAll(env, TABLES.player, "{Active}=TRUE()"),
    ]);

    const teams = teamRecords.map(mapTeam);
    const players = playerRecords.map(mapPlayer);

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
      const teamRecords = await airtableFindAll(env, TABLES.team);
      const coachIds = new Set<string>();
      const sectionCaptainIds = new Set<string>();
      const coachTeamNamesByPersonId: Record<string, string[]> = {};
      const allTeamNames: string[] = [];
      for (const record of teamRecords) {
        const teamName = record.fields?.[TEAMS_FIELDS.teamName] || "";
        if (teamName) allTeamNames.push(teamName);
        const coach = record.fields?.[TEAMS_FIELDS.coach];
        const sectionCaptain = record.fields?.[TEAMS_FIELDS.sectionCaptain];
        for (const id of Array.isArray(coach) ? coach : []) {
          if (typeof id !== "string") continue;
          coachIds.add(id);
          if (teamName) (coachTeamNamesByPersonId[id] ??= []).push(teamName);
        }
        for (const id of Array.isArray(sectionCaptain) ? sectionCaptain : []) {
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

/**
 * Which officer table a role comes from.
 *
 * "sectionCaptain" is a row in the Section Captains TABLE. That is not the
 * same thing as AuthorizedUser.isSectionCaptain, which comes from the
 * Teams.Section Captain link and grants coach access to every team. The
 * officers' sections are gated on the table (owner decision, 2026-09-25).
 */
export type Office = "membershipOfficer" | "sectionChair" | "sectionCaptain";

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
 * The membership board (membership.ts). Declared here rather than there so
 * airtableWebhook.ts can name it without a circular import.
 */
export const MEMBERSHIP_BOARD_KEY = "membership-board";

export async function getOfficerLinks(env: Env): Promise<OfficerLinks> {
  return getShared<OfficerLinks>(
    env,
    OFFICER_LINKS_KEY,
    async () => {
      const offices: [Office, string][] = [
        ["membershipOfficer", TABLES.membershipOfficer],
        ["sectionChair", TABLES.sectionChair],
        ["sectionCaptain", TABLES.sectionCaptainOffice],
      ];
      const tables = await Promise.all(
        offices.map(([, table]) => airtableFindAll(env, table, `{${OFFICER_FIELDS.status}}="Active"`)),
      );
      const rolesByPersonId: Record<string, OfficerRole[]> = {};
      offices.forEach(([office], i) => {
        for (const record of tables[i]) {
          const designation = record.fields?.[OFFICER_FIELDS.designation];
          const member = record.fields?.[OFFICER_FIELDS.member];
          for (const id of Array.isArray(member) ? member : []) {
            if (typeof id !== "string") continue;
            (rolesByPersonId[id] ??= []).push({
              office,
              designation: typeof designation === "string" ? designation : "",
            });
          }
        }
      });
      return { rolesByPersonId };
    },
    rawReadTtl(env, REFERENCE_TTL_MS),
  );
}

export async function getActivePlayers(env: Env): Promise<Player[]> {
  const records = await airtableFindAll(env, TABLES.player, "{Active}=TRUE()");
  return records.map(mapPlayer);
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
  // Matching an email is case-insensitive on BOTH sides, unconditionally.
  //
  // Airtable's "=" compares text case-sensitively, so the original
  // {Email}="<address>" missed every People record whose Email held a capital
  // letter and refused that person as if they were not in the club. LOWER()
  // fixes the stored side. Lowercasing here rather than trusting the caller
  // fixes the other side: auth.ts happens to pass a normalized address, but a
  // caller that did not (recordRankingEvents resolving an actor, say) would
  // reintroduce exactly the same silent miss.
  const normalized = normalizeEmail(email);
  const records = await airtableFindAll(
    env,
    TABLES.player,
    `LOWER({${PEOPLE_FIELDS.email}})="${escapeFormulaValue(normalized)}"`
  );
  // Airtable cannot enforce uniqueness on Email, and a stale duplicate is
  // easy to create. Taking whichever record came back first let a superseded
  // row decide someone's access: the person is refused while the record an
  // administrator is looking at plainly says Active. Prefer an active record
  // over an inactive one, and always say in the logs that a choice was made,
  // so the underlying duplicate still gets cleaned up.
  if (records.length > 1) {
    console.warn(
      `${records.length} People records share the email ${normalized}: ` +
        `${records.map((r) => r.id).join(", ")} - resolve the duplicate in Airtable`,
    );
  }
  const chosen = records.find((r) => r.fields?.[PEOPLE_FIELDS.active] === true) ?? records[0];
  return chosen ? mapPlayer(chosen) : null;
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
    if (uniqueSeasons.length === 0) return [];
    const formula = uniqueSeasons.length === 1
      ? `{${AVAILABILITYEXCEPTIONS_FIELDS.season}}="${escapeFormulaValue(uniqueSeasons[0])}"`
      : `OR(${uniqueSeasons.map((s) => `{${AVAILABILITYEXCEPTIONS_FIELDS.season}}="${escapeFormulaValue(s)}"`).join(",")})`;
    const records = await airtableFindAll(env, TABLES.availabilityException, formula);
    return records.map(mapAvailability);
  };
  if (opts?.fresh) return load();
  return getShared<AvailabilityException[]>(env, cacheKey, load, rawReadTtl(env, EXCEPTIONS_TTL_MS));
}

const EXCEPTIONS_TTL_MS = 5 * 60 * 1000;

export { invalidateCache };
