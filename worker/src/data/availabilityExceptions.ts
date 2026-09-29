import { airtableFindAll, escapeFormulaValue } from "../airtable";
import type { Env } from "../env";
import { pick } from "./backend";
import { TABLES } from "../../../shared/schema/tableNames";
import { AVAILABILITYEXCEPTIONS_FIELDS } from "../../../shared/schema/fieldMaps";
import { mapAvailability } from "../../../shared/mappers/availabilityMapper";
import type { AvailabilityException } from "../../../shared/schema/domainTypes";

export interface AvailabilityExceptionsRepo {
  /** Exceptions for matches in any of the given (non-empty, de-duplicated) seasons. */
  listForSeasons(seasons: string[]): Promise<AvailabilityException[]>;
}

function airtableAvailabilityExceptions(env: Env): AvailabilityExceptionsRepo {
  return {
    async listForSeasons(seasons) {
      if (seasons.length === 0) return [];
      const clause = (s: string) => `{${AVAILABILITYEXCEPTIONS_FIELDS.season}}="${escapeFormulaValue(s)}"`;
      const formula = seasons.length === 1 ? clause(seasons[0]) : `OR(${seasons.map(clause).join(",")})`;
      const records = await airtableFindAll(env, TABLES.availabilityException, formula);
      return records.map(mapAvailability);
    },
  };
}

export function availabilityExceptions(env: Env): AvailabilityExceptionsRepo {
  return pick(env, "availabilityExceptions", airtableAvailabilityExceptions);
}
