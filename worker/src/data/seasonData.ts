import type { Env } from "../env";
import type { AvailabilityException, Match, MatchCard } from "../../../shared/schema/domainTypes";
import type { ManualSuspension } from "../suspension";
import { supabaseSeasonData } from "./supabase/seasonData";

/**
 * Everything the season context (seasonContext.ts) is built from, in one
 * read: season_context(p_season, p_player) (supabase/migrations/
 * *_season_context.sql), decoded into the domain shapes the eligibility,
 * suspension, stats and attendance code already reads.
 *
 * `player` (a People api id) narrows it to what that one player's own
 * screens need: their cards plus every card with a goal or a card value,
 * and their answers plus those of anyone selected. Matches, selections,
 * last season and the suspensions are complete either way.
 */
export interface SeasonData {
  /** The season's matches (every status), with their selections. */
  matches: Match[];
  /** The season's match cards (narrowed for a player). */
  cards: MatchCard[];
  /** The season's availability answers (narrowed for a player; notes only for the whole season). */
  exceptions: AvailabilityException[];
  /** Last season's Played matches, and any with a carded card. */
  previousMatches: Match[];
  /** Last season's carded cards, everyone's. */
  previousCards: MatchCard[];
  /** The Men's Convenor's open suspensions. */
  suspensions: ManualSuspension[];
  /**
   * Per current-season match id: the distinct teams on its cards and how
   * many cards it has, from EVERY card (narrowed or not), for "matches with
   * cards" and the completed-league counts.
   */
  cardSummary: Map<string, { teams: string[]; count: number }>;
}

export interface SeasonDataRepo {
  load(season: string, player?: string): Promise<SeasonData>;
}

export function seasonData(env: Env): SeasonDataRepo {
  return supabaseSeasonData(env);
}
