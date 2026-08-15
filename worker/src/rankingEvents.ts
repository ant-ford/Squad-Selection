/**
 * Ranking Events - persisted audit trail for Section Rank changes.
 *
 * New Airtable table "Ranking Events" (created by the Section Captain /
 * admin; the Worker degrades gracefully until it exists):
 *
 *   Player        link (People)   - the player whose rank changed
 *   Actor         link (People)   - the coach / section captain who made the change
 *   Actor Email   text            - verified session email (identity, spec 4.3)
 *   Kind          single select   - move | reorder | activate | deactivate
 *   Old Rank      number          - previous Section Rank (blank when none)
 *   New Rank      number          - new Section Rank (blank when deactivated)
 *   Justification long text       - optional note, max 280 chars
 *   Timestamp     dateTime        - server-side, stamped at commit time
 *
 * Deliberately NOT "Selection Events": that table (a) does not exist yet in
 * the live schema and (b) has no timestamp / rank fields - it logs
 * player-in-match selections, not rank changes.
 */

import { Env, airtableFindAll, airtableFindById, airtableBatchCreate } from "./airtable";
import { getReferenceData, getPlayerByEmail } from "./reference";
import { HttpError } from "./http";
import { TABLES } from "../../src/generated/tableNames";
import { getCached } from "../../src/lib/cache";

export const RANKING_EVENTS_TABLE = "Ranking Events";
export const RANKING_EVENTS_FIELDS = {
  player: "Player",
  actor: "Actor",
  actorEmail: "Actor Email",
  kind: "Kind",
  oldRank: "Old Rank",
  newRank: "New Rank",
  justification: "Justification",
  timestamp: "Timestamp",
} as const;

export type RankingEventKind = "move" | "reorder" | "activate" | "deactivate";

export const MAX_JUSTIFICATION_CHARS = 280;

/** Optional note for a rank change: trimmed, max 280 chars. Throws 400 when too long. */
export function validateJustification(note?: string | null): string | undefined {
  if (note === undefined || note === null) return undefined;
  const trimmed = String(note).trim();
  if (trimmed.length > MAX_JUSTIFICATION_CHARS) {
    throw new HttpError(
      `Justification must be ${MAX_JUSTIFICATION_CHARS} characters or fewer`,
      400,
      "JUSTIFICATION_TOO_LONG",
    );
  }
  return trimmed || undefined;
}

export interface RankingEventInput {
  playerId: string;
  actorEmail?: string;
  kind: RankingEventKind;
  oldRank?: number | null;
  newRank?: number | null;
  justification?: string;
}

/**
 * Every player whose rank actually changed produces an event - the audit is
 * complete, with no magnitude threshold. Unchanged players are skipped.
 * Airtable write batching (10 records per request) is handled by
 * recordRankingEvents, so large reorders are still recorded in full.
 */
export function selectRankingEventChanges(
  updates: { id: string; oldRank?: number | null; rank?: number | null }[],
): { id: string; oldRank: number | null; newRank: number | null }[] {
  return updates
    .filter((u) => (u.oldRank ?? null) !== (u.rank ?? null))
    .map((u) => ({
      id: u.id,
      oldRank: u.oldRank ?? null,
      newRank: u.rank ?? null,
    }));
}

/** Server-side timestamp: the Worker stamps events, never the browser. */
export function buildRankingEventRecords(
  events: RankingEventInput[],
  now: Date = new Date(),
): { event: RankingEventInput; timestamp: string }[] {
  const ts = now.toISOString();
  return events.map((e) => ({ event: e, timestamp: ts }));
}

/**
 * Fire-and-forget: records the events after a successful rank commit and
 * never blocks or fails the mutation. Actor link is resolved from the
 * verified session email via the People table (never client-supplied).
 */
export async function recordRankingEvents(env: Env, events: RankingEventInput[]): Promise<void> {
  if (events.length === 0) return;
  void (async () => {
    try {
      const stamped = buildRankingEventRecords(events);
      const emails = [...new Set(events.map((e) => e.actorEmail).filter(Boolean))] as string[];
      const idByEmail = new Map<string, string>();
      for (const email of emails) {
        const actor = await getPlayerByEmail(env, email);
        if (actor) idByEmail.set(email, actor.id);
      }
      const rows = stamped.map(({ event, timestamp }) => {
        const actorId = event.actorEmail ? idByEmail.get(event.actorEmail) : undefined;
        return {
          [RANKING_EVENTS_FIELDS.player]: [event.playerId],
          [RANKING_EVENTS_FIELDS.actor]: actorId ? [actorId] : [],
          [RANKING_EVENTS_FIELDS.actorEmail]: event.actorEmail || "",
          [RANKING_EVENTS_FIELDS.kind]: event.kind,
          [RANKING_EVENTS_FIELDS.oldRank]: event.oldRank ?? null,
          [RANKING_EVENTS_FIELDS.newRank]: event.newRank ?? null,
          [RANKING_EVENTS_FIELDS.justification]: event.justification || "",
          [RANKING_EVENTS_FIELDS.timestamp]: timestamp,
        };
      });
      // Airtable accepts up to 10 records per create request - chunk so a
      // full-table reorder (many changed players) is still audited in full.
      for (let i = 0; i < rows.length; i += 10) {
        await airtableBatchCreate(env, RANKING_EVENTS_TABLE, rows.slice(i, i + 10));
      }
    } catch (err) {
      console.error("[RankingEvents] failed to record events:", err);
    }
  })();
}

export interface RankingChange {
  id: string;
  playerId: string;
  kind: string;
  playerName: string;
  actorName: string;
  oldRank: number | null;
  newRank: number | null;
  note: string;
  at: string;
}

const RANKING_EVENTS_TTL_MS = 60 * 1000;

/**
 * Most recent ranking events within `days`, newest first, capped at the 20
 * newest. Names are joined from the club reference; players no longer in the
 * active reference are resolved individually (bounded - only the returned
 * slice needs names). Returns [] when the table does not exist yet.
 */
export async function getRankingEvents(env: Env, days = 7): Promise<RankingChange[]> {
  const { data } = await getCached<RankingChange[]>(
    `ranking-events:${days}`,
    async () => {
      try {
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        const records = await airtableFindAll(env, RANKING_EVENTS_TABLE, undefined, {
          sort: JSON.stringify([{ field: RANKING_EVENTS_FIELDS.timestamp, direction: "desc" }]),
        });
        const fresh = records.filter((r) => {
          const at = r.fields?.[RANKING_EVENTS_FIELDS.timestamp];
          return typeof at === "string" && at >= since;
        });
        const ref = await getReferenceData(env);
        const playerById = new Map(ref.players.map((p) => [p.id, p]));
        const actorIdByEmail = new Map<string, string>();
        for (const p of ref.players) {
          if (p.email) actorIdByEmail.set(p.email.trim().toLowerCase(), p.id);
        }
        const missingIds = new Set<string>();
        for (const r of fresh) {
          const pid = r.fields?.[RANKING_EVENTS_FIELDS.player]?.[0];
          if (typeof pid === "string" && !playerById.has(pid)) missingIds.add(pid);
        }
        for (const pid of missingIds) {
          try {
            const rec = await airtableFindById(env, TABLES.player, pid);
            if (rec) {
              const f = rec.fields ?? {};
              playerById.set(pid, {
                id: pid,
                preferredName: f["Preferred Name"],
                givenNames: f["Given Name(s)"],
                email: f["Email"],
              } as never);
            }
          } catch {
            /* name resolution is best-effort */
          }
        }
        const nameOf = (id: string) => {
          const p = playerById.get(id);
          if (!p) return "";
          return p.preferredName || p.givenNames || "Player";
        };
        return fresh.slice(0, 20).map((r) => {
          const f = r.fields ?? {};
          const playerId = f[RANKING_EVENTS_FIELDS.player]?.[0] ?? "";
          const actorEmail = String(f[RANKING_EVENTS_FIELDS.actorEmail] || "").trim().toLowerCase();
          const actorId = f[RANKING_EVENTS_FIELDS.actor]?.[0] ?? actorIdByEmail.get(actorEmail) ?? "";
          return {
            id: r.id,
            playerId,
            kind: String(f[RANKING_EVENTS_FIELDS.kind] || "move"),
            playerName: nameOf(playerId) || "Player",
            actorName: nameOf(actorId) || "Coach",
            oldRank: typeof f[RANKING_EVENTS_FIELDS.oldRank] === "number" ? f[RANKING_EVENTS_FIELDS.oldRank] : null,
            newRank: typeof f[RANKING_EVENTS_FIELDS.newRank] === "number" ? f[RANKING_EVENTS_FIELDS.newRank] : null,
            note: String(f[RANKING_EVENTS_FIELDS.justification] || ""),
            at: String(f[RANKING_EVENTS_FIELDS.timestamp] || ""),
          };
        });
      } catch (err) {
        // Table not created yet - the history degrades to empty.
        console.error("[RankingEvents] table unavailable:", err);
        return [];
      }
    },
    RANKING_EVENTS_TTL_MS,
  );
  return data;
}
