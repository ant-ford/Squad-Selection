import type { Env } from "../env";
import { supabaseMatchCards } from "./supabase/squad";
import type { MatchCard } from "../../../shared/schema/domainTypes";

export interface MatchCardsRepo {
  /**
   * A season's Match Cards (every card when `season` is empty). `cardedOnly`
   * keeps only appearances that carry a card.
   */
  listForSeason(season: string, opts?: { cardedOnly?: boolean }): Promise<MatchCard[]>;
}

export function matchCards(env: Env): MatchCardsRepo {
  return supabaseMatchCards(env);
}
