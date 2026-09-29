import { airtableFindAll, escapeFormulaValue } from "../airtable";
import type { Env } from "../env";
import { pick } from "./backend";
import { TABLES } from "../../../shared/schema/tableNames";
import { MATCHES_FIELDS } from "../../../shared/schema/fieldMaps";
import { mapMatch } from "../../../shared/mappers/matchMapper";
import type { Match } from "../../../shared/schema/domainTypes";

export interface MatchesRepo {
  /** Every match in the season; an empty season means every match there is. */
  listForSeason(season: string): Promise<Match[]>;
  /** Every match with Match Status = Scheduled, any season. */
  listScheduled(): Promise<Match[]>;
  /** Played matches in any of the given (non-empty, de-duplicated) seasons. */
  listPlayedForSeasons(seasons: string[]): Promise<Match[]>;
}

function airtableMatches(env: Env): MatchesRepo {
  return {
    async listForSeason(season) {
      const formula = season ? `{${MATCHES_FIELDS.season}}="${escapeFormulaValue(season)}"` : undefined;
      const records = await airtableFindAll(env, TABLES.match, formula);
      return records.map(mapMatch);
    },

    async listScheduled() {
      const records = await airtableFindAll(env, TABLES.match, '{Match Status}="Scheduled"');
      return records.map(mapMatch);
    },

    async listPlayedForSeasons(seasons) {
      if (seasons.length === 0) return [];
      const seasonClause = seasons.length === 1
        ? `{Season}="${seasons[0]}"`
        : `OR(${seasons.map((s) => `{Season}="${s}"`).join(",")})`;
      const records = await airtableFindAll(env, TABLES.match, `AND({Match Status}="Played",${seasonClause})`);
      return records.map(mapMatch);
    },
  };
}

export function matches(env: Env): MatchesRepo {
  return pick(env, "matches", airtableMatches);
}
