import type { Env } from "../env";
import { supabaseMatches } from "./supabase/squad";
import type { Match } from "../../../shared/schema/domainTypes";

/** The Matches fields the Worker writes. A key left out is not touched. */
export type MatchPatch = Partial<
  Pick<Match, "selectedPlayersHome" | "selectedPlayersAway" | "autoSelectEnabled" | "homeKit" | "awayKit">
>;

/** Adds and removes for one side of a match, applied to the squad as it is now. */
export interface SelectionChange {
  side: "home" | "away";
  add: string[];
  remove: string[];
  /**
   * The side's version the caller saw. A change made since then that
   * touched one of the same players makes it a conflict. Null skips the
   * check (same-day releases).
   */
  version: number | null;
  /** People id of whoever made the change, for the change record. */
  actorId?: string | null;
  source: "coach" | "release";
}

export type SelectionChangeResult =
  | {
      status: "ok";
      version: number;
      /** The other side's new version when a derby add took players off it. */
      otherVersion: number | null;
      /** The players that really changed (re-adding or re-removing is a no-op). */
      added: string[];
      removed: string[];
      selected: string[];
    }
  | { status: "unchanged"; version: number; selected: string[] }
  /** players: changed by someone else since `version` (empty when the version was never valid). */
  | { status: "conflict"; version: number; players: string[]; selected: string[] };

export interface MatchesRepo {
  /** One match, read fresh; null when there is no such match. */
  getById(id: string): Promise<Match | null>;
  update(id: string, patch: MatchPatch): Promise<void>;
  /** One transaction: the change, the version bump and the change record (apply_squad_changes). */
  applySelectionChanges(id: string, change: SelectionChange): Promise<SelectionChangeResult>;
  /** Every match in the season; an empty season means every match there is. */
  listForSeason(season: string): Promise<Match[]>;
  /** Every match with Match Status = Scheduled, any season. */
  listScheduled(): Promise<Match[]>;
  /** Matches called off (Rescheduled, Cancelled, Postponed) since the given time (changed_at). */
  listCalledOffSince(sinceIso: string): Promise<Match[]>;
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
