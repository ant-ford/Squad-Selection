import type { Env } from "../env";
import { supabaseAvailabilityExceptions } from "./supabase/squad";
import type { AvailabilityException } from "../../../shared/schema/domainTypes";

/** One player's answer for one match, as stored. */
export interface ExceptionWrite {
  matchId: string;
  playerId: string;
  status: "Available" | "Maybe" | "Unavailable";
  notes?: string;
  /** Who gave the answer: the player, or a coach on their behalf. */
  updatedById: string;
}

export interface ExceptionChanges {
  deleteIds: string[];
  updates: { id: string; write: ExceptionWrite }[];
  creates: ExceptionWrite[];
}

export interface AvailabilityExceptionsRepo {
  /** Exceptions for matches in any of the given (non-empty, de-duplicated) seasons. */
  listForSeasons(seasons: string[]): Promise<AvailabilityException[]>;
  /**
   * Deletes, then updates, then creates. Returns the new records' ids in the
   * order of `creates`.
   */
  apply(changes: ExceptionChanges): Promise<{ createdIds: string[] }>;
}

export function availabilityExceptions(env: Env): AvailabilityExceptionsRepo {
  return supabaseAvailabilityExceptions(env);
}
