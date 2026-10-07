import type { Env } from "../env";
import { supabaseRankingEvents } from "./supabase/squad";

/** One rank change as stored. */
export interface RankingEventRow {
  id: string;
  playerId: string;
  /** The coach's People id, when their email matched a person. */
  actorId?: string;
  actorEmail: string;
  kind: string;
  oldRank: number | null;
  newRank: number | null;
  justification: string;
  /** ISO timestamp, server-stamped; empty if missing. */
  timestamp: string;
}

export type NewRankingEvent = Omit<RankingEventRow, "id">;

export interface RankingEventsRepo {
  create(events: NewRankingEvent[]): Promise<void>;
  /**
   * Up to `limit` events stamped at or after `since` (and at or before `upTo`,
   * when given), newest first (ties by id, as select() adds it). ISO timestamps.
   */
  listRecent(since: string, limit: number, upTo?: string): Promise<RankingEventRow[]>;
}

export function rankingEvents(env: Env): RankingEventsRepo {
  return supabaseRankingEvents(env);
}
