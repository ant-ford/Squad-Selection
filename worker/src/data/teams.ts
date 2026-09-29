import { airtableFindAll } from "../airtable";
import type { Env } from "../env";
import { pick } from "./backend";
import { TABLES } from "../../../shared/schema/tableNames";
import { mapTeam } from "../../../shared/mappers/teamMapper";
import type { Team } from "../../../shared/schema/domainTypes";

export interface TeamsRepo {
  listActive(): Promise<Team[]>;
  /** Every team, Active or not - authorization must not depend on a team's Active flag. */
  listAll(): Promise<Team[]>;
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
  };
}

export function teams(env: Env): TeamsRepo {
  return pick(env, "teams", airtableTeams);
}
