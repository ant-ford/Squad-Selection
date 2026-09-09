import { airtableFindAll, escapeFormulaValue } from "./airtable";
import type { Env } from "./env";
import { getCached, invalidateCache, invalidateCachePrefix } from "./cache";
import { TABLES } from "../../shared/schema/tableNames";
import { PEOPLE_FIELDS, TEAMS_FIELDS, AVAILABILITYEXCEPTIONS_FIELDS } from "../../shared/schema/fieldMaps";
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
  const { data } = await getCached<ReferenceData>("club-reference", async () => {
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
  }, 10 * 60 * 1000); // 10 minutes

  return data;
}

/**
 * Coach / Section Captain relationships across ALL team records â€” including
 * teams currently marked inactive. Authorization must depend on the person's
 * role, not on whether a team record happens to be inactive, so this lookup
 * deliberately skips the "{Active}=TRUE()" filter used by getReferenceData().
 */
export interface TeamCoachLinks {
  coachIds: string[];
  sectionCaptainIds: string[];
  /** Team names each person coaches (Teams.Coach link), keyed by People record id. */
  coachTeamNamesByPersonId: Map<string, string[]>;
  /** Every team name, regardless of Active status - a Section Captain sees the whole section. */
  allTeamNames: string[];
}

export async function getTeamCoachLinks(env: Env): Promise<TeamCoachLinks & { cached: boolean }> {
  const { data, fromCache } = await getCached<TeamCoachLinks>(
    "team-coach-links",
    async () => {
      const teamRecords = await airtableFindAll(env, TABLES.team);
      const coachIds = new Set<string>();
      const sectionCaptainIds = new Set<string>();
      const coachTeamNamesByPersonId = new Map<string, string[]>();
      const allTeamNames: string[] = [];
      for (const record of teamRecords) {
        const teamName = record.fields?.[TEAMS_FIELDS.teamName] || "";
        if (teamName) allTeamNames.push(teamName);
        const coach = record.fields?.[TEAMS_FIELDS.coach];
        const sectionCaptain = record.fields?.[TEAMS_FIELDS.sectionCaptain];
        for (const id of Array.isArray(coach) ? coach : []) {
          if (typeof id !== "string") continue;
          coachIds.add(id);
          if (teamName) {
            const names = coachTeamNamesByPersonId.get(id) ?? [];
            names.push(teamName);
            coachTeamNamesByPersonId.set(id, names);
          }
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
    10 * 60 * 1000, // 10 minutes, same TTL as the club-reference cache
  );
  return { ...data, cached: fromCache };
}

export async function getActivePlayers(env: Env): Promise<Player[]> {
  const records = await airtableFindAll(env, TABLES.player, "{Active}=TRUE()");
  return records.map(mapPlayer);
}

const PLAYER_BY_EMAIL_TTL_MS = 60 * 1000;

function playerByEmailKey(email: string): string {
  return `player-by-email:${email.trim().toLowerCase()}`;
}

export function invalidatePlayerByEmail(email: string): void {
  invalidateCache(playerByEmailKey(email));
}

/**
 * Fan-out for a write that changes club reference data (team rosters,
 * coach links, ability/rank fields) - every read built on top of
 * getReferenceData/getTeamCoachLinks or a per-match player list would
 * otherwise keep serving the pre-write snapshot.
 */
export function invalidateReferenceData(): void {
  invalidateCache("club-reference");
  invalidateCache("team-coach-links");
  invalidateCachePrefix("players-for-match:");
}

/**
 * People-record lookup by email, cached for 60s. Every caller, including
 * the authorization path in worker/src/auth.ts, reuses that short-TTL entry,
 * so an Airtable correction takes up to a minute to change an access
 * decision. Pass { fresh: true } to bypass the cache for a live read.
 */
export async function getPlayerByEmail(
  env: Env,
  email: string,
  opts?: { fresh?: boolean },
): Promise<Player | null> {
  if (opts?.fresh) {
    return lookupPlayerByEmail(env, email);
  }
  const { data } = await getCached<Player | null>(
    playerByEmailKey(email),
    () => lookupPlayerByEmail(env, email),
    PLAYER_BY_EMAIL_TTL_MS,
  );
  return data;
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
  const normalized = email.trim().toLowerCase();
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

export async function getExceptionsForSeasons(env: Env, seasons: string[]): Promise<AvailabilityException[]> {
  const uniqueSeasons = [...new Set(seasons.filter(Boolean))].sort();
  const cacheKey = `exceptions:${uniqueSeasons.join(",") || "none"}`;
  const { data } = await getCached<AvailabilityException[]>(cacheKey, async () => {
    if (uniqueSeasons.length === 0) return [];
    const formula = uniqueSeasons.length === 1
      ? `{${AVAILABILITYEXCEPTIONS_FIELDS.season}}="${escapeFormulaValue(uniqueSeasons[0])}"`
      : `OR(${uniqueSeasons.map((s) => `{${AVAILABILITYEXCEPTIONS_FIELDS.season}}="${escapeFormulaValue(s)}"`).join(",")})`;
    const records = await airtableFindAll(env, TABLES.availabilityException, formula);
    return records.map(mapAvailability);
  }, 5 * 60 * 1000);
  return data;
}

export { invalidateCache };
