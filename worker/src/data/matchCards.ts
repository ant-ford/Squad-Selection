import { airtableFindAll, escapeFormulaValue } from "../airtable";
import type { Env } from "../env";
import { pick } from "./backend";
import { TABLES } from "../../../shared/schema/tableNames";
import { MATCHCARDS_FIELDS } from "../../../shared/schema/fieldMaps";
import { mapMatchCard } from "../../../shared/mappers/matchCardMapper";
import type { MatchCard } from "../../../shared/schema/domainTypes";

export interface MatchCardsRepo {
  /**
   * A season's Match Cards (every card when `season` is empty). `cardedOnly`
   * keeps only appearances that carry a card.
   */
  listForSeason(season: string, opts?: { cardedOnly?: boolean }): Promise<MatchCard[]>;
}

function airtableMatchCards(env: Env): MatchCardsRepo {
  return {
    async listForSeason(season, opts = {}) {
      const clauses: string[] = [];
      if (season) clauses.push(`{${MATCHCARDS_FIELDS.season}}="${escapeFormulaValue(season)}"`);
      if (opts.cardedOnly) clauses.push(`{${MATCHCARDS_FIELDS.cards}}!=""`);
      const formula = clauses.length === 0 ? undefined : clauses.length === 1 ? clauses[0] : `AND(${clauses.join(",")})`;
      const records = await airtableFindAll(env, TABLES.matchCard, formula);
      return records.map(mapMatchCard);
    },
  };
}

export function matchCards(env: Env): MatchCardsRepo {
  return pick(env, "matchCards", airtableMatchCards);
}
