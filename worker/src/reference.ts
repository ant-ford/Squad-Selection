import { Env, airtableFindAll, escapeFormulaValue } from "./airtable";
import { getCached, invalidateCache } from "../../src/lib/cache";
import { TABLES } from "../../src/generated/tableNames";
import { PEOPLE_FIELDS } from "../../src/generated/fieldMaps";
import { mapPlayer } from "../../src/mappers/playerMapper";
import { mapTeam } from "../../src/mappers/teamMapper";
import type { Player, Team } from "../../src/generated/domainTypes";

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

// Export invalidate for use in other files
export { invalidateCache };
