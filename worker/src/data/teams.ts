import { airtableFindAll, airtableUpdate } from "../airtable";
import type { Env } from "../env";
import { pick } from "./backend";
import { supabaseTeams } from "./supabase/squad";
import { TABLES } from "../../../shared/schema/tableNames";
import { TEAMS_FIELDS } from "../../../shared/schema/fieldMaps";
import { mapTeam } from "../../../shared/mappers/teamMapper";
import type { Team } from "../../../shared/schema/domainTypes";

export interface TeamsRepo {
  listActive(): Promise<Team[]>;
  /** Every team, Active or not - authorization must not depend on a team's Active flag. */
  listAll(): Promise<Team[]>;
  /** Replaces the team's Auto Select Players list. */
  setAutoSelectPlayers(teamId: string, playerIds: string[]): Promise<void>;
}

function airtableTeams(env: Env): TeamsRepo {
  return {
    async listActive() {
      const records = await airtableFindAll(env, TABLES.team, "{Active}=TRUE()");
      return records.map(mapTeam);
    },
    async listAll() {
      const records = await airtableFindAll(env, TABLES.team);
      return records.map(mapTeam);
    },
    async setAutoSelectPlayers(teamId, playerIds) {
      await airtableUpdate(env, TABLES.team, teamId, { [TEAMS_FIELDS.autoSelectPlayers]: playerIds });
    },
  };
}

export function teams(env: Env): TeamsRepo {
  return pick(env, "teams", airtableTeams, supabaseTeams);
}
