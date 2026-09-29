import { airtableBatchCreate, airtableFindAll } from "../airtable";
import type { Env } from "../env";
import { pick } from "./backend";
import { supabaseRankingEvents } from "./supabase/squad";
import { RANKING_EVENTS_TABLE } from "../../../shared/schema/tableNames";
import { RANKING_EVENTS_FIELDS } from "../../../shared/schema/fieldMaps";

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
  listNewestFirst(): Promise<RankingEventRow[]>;
}

const F = RANKING_EVENTS_FIELDS;

function mapRankingEvent(record: any): RankingEventRow {
  const f = record.fields ?? {};
  const player = f[F.player]?.[0];
  const actor = f[F.actor]?.[0];
  const at = f[F.timestamp];
  return {
    id: record.id,
    playerId: typeof player === "string" ? player : "",
    actorId: typeof actor === "string" ? actor : undefined,
    actorEmail: String(f[F.actorEmail] || ""),
    kind: String(f[F.kind] || "move"),
    oldRank: typeof f[F.oldRank] === "number" ? f[F.oldRank] : null,
    newRank: typeof f[F.newRank] === "number" ? f[F.newRank] : null,
    justification: String(f[F.justification] || ""),
    timestamp: typeof at === "string" ? at : "",
  };
}

function airtableRankingEvents(env: Env): RankingEventsRepo {
  return {
    async create(events) {
      const rows = events.map((e) => ({
        [F.player]: [e.playerId],
        [F.actor]: e.actorId ? [e.actorId] : [],
        [F.actorEmail]: e.actorEmail,
        [F.kind]: e.kind,
        [F.oldRank]: e.oldRank,
        [F.newRank]: e.newRank,
        [F.justification]: e.justification,
        [F.timestamp]: e.timestamp,
      }));
      // Airtable accepts up to 10 records per create request - chunk so a
      // full-table reorder (many changed players) is still audited in full.
      for (let i = 0; i < rows.length; i += 10) {
        await airtableBatchCreate(env, RANKING_EVENTS_TABLE, rows.slice(i, i + 10));
      }
    },

    async listNewestFirst() {
      // Airtable rejects a single JSON-encoded `sort` parameter with HTTP
      // 422 - the sort must be passed as bracketed query parameters.
      const records = await airtableFindAll(
        env,
        RANKING_EVENTS_TABLE,
        undefined,
        { "sort[0][field]": F.timestamp, "sort[0][direction]": "desc" },
        Object.values(F),
      );
      return records.map(mapRankingEvent);
    },
  };
}

export function rankingEvents(env: Env): RankingEventsRepo {
  return pick(env, "rankingEvents", airtableRankingEvents, supabaseRankingEvents);
}
