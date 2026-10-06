import type { Env } from "../env";
import { supabaseAvailabilityExceptions } from "./supabase/squad";
import type { AvailabilityException } from "../../../shared/schema/domainTypes";

export type ExceptionStatus = "Available" | "Maybe" | "Unavailable";

/** One player's answer for some matches. */
export interface AvailabilityAnswer {
  playerId: string;
  matchIds: string[];
  status: ExceptionStatus;
  notes?: string;
  /** Who gave the answer, for Updated By: a coach on the player's behalf. Defaults to the player. */
  updatedById?: string;
}

/** What set_availability found and did. */
export interface AvailabilityOutcome {
  updated: number;
  /** Kept and deleted (exceptionId null) in input order, then created. */
  results: { matchId: string; exceptionId: string | null }[];
  /** The player's rows for these matches before the write, for the audit line. */
  before: { matchId: string; exceptionId: string; status: string }[];
  /** Seasons of the matches found, for clearing this isolate's season caches. */
  seasons: string[];
}

export interface AvailabilityExceptionsRepo {
  /** Exceptions for matches in any of the given (non-empty, de-duplicated) seasons. */
  listForSeasons(seasons: string[]): Promise<AvailabilityException[]>;
  /**
   * The answer, read-modify-write in one transaction (set_availability):
   * Maybe/Unavailable stored, Available stored only where it overrides the
   * player's Opt-In Only or standing rules and deleted otherwise. Throws a
   * P0002 SupabaseError for an unknown or inactive player or an unknown match.
   */
  set(answer: AvailabilityAnswer): Promise<AvailabilityOutcome>;
  /** The same for every Scheduled HKFC match on one Hong Kong day (set_availability_for_date). */
  setForDate(answer: { playerId: string; date: string; status: ExceptionStatus; notes?: string }): Promise<AvailabilityOutcome>;
}

export function availabilityExceptions(env: Env): AvailabilityExceptionsRepo {
  return supabaseAvailabilityExceptions(env);
}
