import { Env, airtableFindAll, escapeFormulaValue } from "./airtable";
import { getCached, invalidateCache } from "../../src/lib/cache";
import { TABLES } from "../../src/generated/tableNames";
import { PEOPLE_FIELDS, TEAMS_FIELDS, AVAILABILITYEXCEPTIONS_FIELDS } from "../../src/generated/fieldMaps";
import { mapPlayer } from "../../src/mappers/playerMapper";
import { mapTeam } from "../../src/mappers/teamMapper";
import { mapAvailability } from "../../src/mappers/availabilityMapper";
import type { Player, Team, AvailabilityException } from "../../src/generated/domainTypes";

export interface ReferenceData {
  players: Player[];
  teams: Team[];
  teamRankMap: Record<string, number>;
  teamNames: string[];
}

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
      if (t.teamName) teamRankMap[t.teamName] = t.teamRank ?? 99;
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
 * Coach / Section Captain relationships across ALL team records — including
 * teams currently marked inactive. Authorization must depend on the person's
 * role, not on whether a team record happens to be inactive, so this lookup
 * deliberately skips the "{Active}=TRUE()" filter used by getReferenceData().
 */
export async function getTeamCoachLinks(env: Env): Promise<{
  coachIds: string[];
  sectionCaptainIds: string[];
}> {
  const { data } = await getCached<{ coachIds: string[]; sectionCaptainIds: string[] }>(
    "team-coach-links",
    async () => {
      const teamRecords = await airtableFindAll(env, TABLES.team);
      const coachIds = new Set<string>();
      const sectionCaptainIds = new Set<string>();
      for (const record of teamRecords) {
        const coach = record.fields?.[TEAMS_FIELDS.coach];
        const sectionCaptain = record.fields?.[TEAMS_FIELDS.sectionCaptain];
        for (const id of Array.isArray(coach) ? coach : []) {
          if (typeof id === "string") coachIds.add(id);
        }
        for (const id of Array.isArray(sectionCaptain) ? sectionCaptain : []) {
          if (typeof id === "string") sectionCaptainIds.add(id);
        }
      }
      return { coachIds: [...coachIds], sectionCaptainIds: [...sectionCaptainIds] };
    },
    10 * 60 * 1000, // 10 minutes, same TTL as the club-reference cache
  );
  return data;
}

export async function getActivePlayers(env: Env): Promise<Player[]> {
  const records = await airtableFindAll(env, TABLES.player, "{Active}=TRUE()");
  return records.map(mapPlayer);
}

export async function getPlayerByEmail(env: Env, email: string): Promise<Player | null> {
  const records = await airtableFindAll(
    env,
    TABLES.player,
    `{${PEOPLE_FIELDS.email}}="${escapeFormulaValue(email)}"`
  );
  return records[0] ? mapPlayer(records[0]) : null;
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
