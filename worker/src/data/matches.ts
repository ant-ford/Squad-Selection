import { airtableFindAll, airtableFindById, airtableUpdate, escapeFormulaValue } from "../airtable";
import type { Env } from "../env";
import { pick } from "./backend";
import { TABLES } from "../../../shared/schema/tableNames";
import { MATCHES_FIELDS } from "../../../shared/schema/fieldMaps";
import { mapMatch } from "../../../shared/mappers/matchMapper";
import type { Match } from "../../../shared/schema/domainTypes";

/** The Matches fields the Worker writes. A key left out is not touched. */
export type MatchPatch = Partial<
  Pick<Match, "selectedPlayersHome" | "selectedPlayersAway" | "autoSelectEnabled" | "homeKit" | "awayKit">
>;

const PATCH_FIELDS: Record<keyof MatchPatch, string> = {
  selectedPlayersHome: MATCHES_FIELDS.selectedPlayersHome,
  selectedPlayersAway: MATCHES_FIELDS.selectedPlayersAway,
  autoSelectEnabled: MATCHES_FIELDS.autoSelectEnabled,
  homeKit: MATCHES_FIELDS.homeKit,
  awayKit: MATCHES_FIELDS.awayKit,
};

export interface MatchesRepo {
  /** One match, read fresh; null when there is no such match. */
  getById(id: string): Promise<Match | null>;
  update(id: string, patch: MatchPatch): Promise<void>;
  /** Every match in the season; an empty season means every match there is. */
  listForSeason(season: string): Promise<Match[]>;
  /** Every match with Match Status = Scheduled, any season. */
  listScheduled(): Promise<Match[]>;
  /** Played matches in any of the given (non-empty, de-duplicated) seasons. */
  listPlayedForSeasons(seasons: string[]): Promise<Match[]>;
}

function airtableMatches(env: Env): MatchesRepo {
  return {
    async getById(id) {
      const record = await airtableFindById(env, TABLES.match, id);
      return record ? mapMatch(record) : null;
    },

    async update(id, patch) {
      const fields: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) fields[PATCH_FIELDS[key as keyof MatchPatch]] = value;
      }
      await airtableUpdate(env, TABLES.match, id, fields);
    },

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
