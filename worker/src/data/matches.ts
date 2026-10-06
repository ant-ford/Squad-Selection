import type { Env } from "../env";
import { supabaseMatches } from "./supabase/squad";
import type { Match } from "../../../shared/schema/domainTypes";

/** The Matches fields the Worker writes. A key left out is not touched. */
export type MatchPatch = Partial<
  Pick<Match, "selectedPlayersHome" | "selectedPlayersAway" | "autoSelectEnabled" | "homeKit" | "awayKit">
>;

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
  /**
   * The same matches with only what a team record reads (date, season,
   * competition, teams, scores, venue): the calendar feed's form lines.
   * About half the bytes; no selections, kit or umpires.
   */
  listResultsForSeasons(seasons: string[]): Promise<Match[]>;
}

export function matches(env: Env): MatchesRepo {
  return supabaseMatches(env);
}
