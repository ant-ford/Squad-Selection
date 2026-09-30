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

import { AirtableError } from "./airtable";
import { people } from "./data/people";
import { rankingEvents, type RankingEventRow } from "./data/rankingEvents";
import type { Env } from "./env";
import { getReferenceData, getPlayerByEmail } from "./reference";
import { HttpError } from "./http";
import { getCached, invalidateCachePrefix } from "./cache";

// Moved to shared/schema; re-exported for existing importers.
export { RANKING_EVENTS_TABLE } from "../../shared/schema/tableNames";
export { RANKING_EVENTS_FIELDS } from "../../shared/schema/fieldMaps";

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
 * Records the events after a successful rank commit. Awaited by the caller:
 * a failed write must surface as an error, not a silently missing audit
 * entry. Actor link is resolved from the verified session email via the
 * People table (never client-supplied).
 */
export async function recordRankingEvents(env: Env, events: RankingEventInput[]): Promise<void> {
  if (events.length === 0) return;
  const stamped = buildRankingEventRecords(events);
  const emails = [...new Set(events.map((e) => e.actorEmail).filter(Boolean))] as string[];
  const idByEmail = new Map<string, string>();
  for (const email of emails) {
    const actor = await getPlayerByEmail(env, email);
    if (actor) idByEmail.set(email, actor.id);
  }
  const rows = stamped.map(({ event, timestamp }) => ({
    playerId: event.playerId,
    actorId: event.actorEmail ? idByEmail.get(event.actorEmail) : undefined,
    actorEmail: event.actorEmail || "",
    kind: event.kind,
    oldRank: event.oldRank ?? null,
    newRank: event.newRank ?? null,
    justification: event.justification || "",
    timestamp,
  }));
  try {
    await rankingEvents(env).create(rows);
  } catch (err) {
    // Table not created yet: keep the documented graceful degradation, the
    // same 404 carve-out the read path makes. The rank change itself has
    // ALREADY been committed to People by the caller, so failing here would
    // report a successful move as a 502 and invite the coach to redo it.
    // Every OTHER failure still propagates - a real write error must surface.
    if (err instanceof AirtableError && err.status === 404) {
      console.error("[RankingEvents] table not created yet (404); rank change committed without an audit row:", err.message);
      return;
    }
    throw err;
  }
  // The next read must reach Airtable immediately - never serve a stale
  // pre-write events list from the 60s cache (spec S8).
  invalidateCachePrefix("ranking-events:");
}

/** Drop every cached ranking-events read (call after a rank commit). */
export function invalidateRankingEventsCache(): void {
  invalidateCachePrefix("ranking-events:");
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

type RankedEvent = Pick<RankingEventRow, "kind" | "actorEmail" | "timestamp" | "oldRank" | "newRank">;

/**
 * Drops the knock-on shifts from the recent-changes list, keeping the
 * players a coach actually moved. Moving someone up three places shifts
 * three others down one each; all four are recorded (the audit stays
 * complete), but only the first is worth reading.
 *
 * One save stamps every event with the same timestamp, so a save is the
 * events sharing timestamp + actor. Within it, the shifted players are the
 * largest set whose order relative to each other didn't change; everyone
 * else was moved. Among equally large sets the one with the smallest
 * total shift wins, so the big jump is the one called a move.
 *
 * Two players trading adjacent places could be either one moving, so
 * both are kept.
 */
export function withoutKnockOnShifts<T extends RankedEvent>(rows: T[]): T[] {
  const saves = new Map<string, T[]>();
  for (const r of rows) {
    if ((r.kind !== "move" && r.kind !== "reorder") || r.oldRank == null || r.newRank == null) continue;
    const key = `${r.timestamp}|${r.actorEmail.trim().toLowerCase()}`;
    saves.set(key, [...(saves.get(key) ?? []), r]);
  }

  const shifted = new Set<T>();
  for (const save of saves.values()) {
    if (save.length < 2) continue;
    if (
      save.length === 2 &&
      Math.abs(save[0].oldRank! - save[1].oldRank!) === 1 &&
      save[0].newRank === save[1].oldRank &&
      save[1].newRank === save[0].oldRank
    ) {
      continue;
    }
    // Unchanged players aren't recorded, but ranks run 1..n, so the gaps
    // between the changed ranks are players who stayed put. They count:
    // dropping below four players who didn't move is a move, not a shift.
    const taken = new Set(save.map((r) => r.oldRank!));
    const lo = Math.min(...taken);
    const hi = Math.max(...taken);
    const byOld: { row?: T; oldRank: number; newRank: number }[] = save.map((r) => ({
      row: r,
      oldRank: r.oldRank!,
      newRank: r.newRank!,
    }));
    for (let rank = lo + 1; rank < hi; rank++) {
      if (!taken.has(rank)) byOld.push({ oldRank: rank, newRank: rank });
    }
    byOld.sort((a, b) => a.oldRank - b.oldRank);

    // Longest run of increasing new ranks (in old-rank order), cheapest on ties.
    const shift = (i: number) => Math.abs(byOld[i].newRank - byOld[i].oldRank);
    const len: number[] = [];
    const cost: number[] = [];
    const prev: number[] = [];
    for (let i = 0; i < byOld.length; i++) {
      len[i] = 1;
      cost[i] = shift(i);
      prev[i] = -1;
      for (let j = 0; j < i; j++) {
        if (byOld[j].newRank >= byOld[i].newRank) continue;
        const l = len[j] + 1;
        const c = cost[j] + shift(i);
        if (l > len[i] || (l === len[i] && c < cost[i])) {
          len[i] = l;
          cost[i] = c;
          prev[i] = j;
        }
      }
    }
    let end = 0;
    for (let i = 1; i < byOld.length; i++) {
      if (len[i] > len[end] || (len[i] === len[end] && cost[i] < cost[end])) end = i;
    }
    const kept: T[] = [];
    for (let i = end; i !== -1; i = prev[i]) {
      const row = byOld[i].row;
      if (row) kept.push(row);
    }
    // A save always moves someone; if nobody reads as moved, show it all.
    if (kept.length === save.length) continue;
    for (const row of kept) shifted.add(row);
  }

  return rows.filter((r) => !shifted.has(r));
}

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
        const rows = await rankingEvents(env).listNewestFirst();
        // Knock-on shifts come out before the cap, or one long move would
        // fill the 20 slots on its own.
        const fresh = withoutKnockOnShifts(rows.filter((r) => r.timestamp !== "" && r.timestamp >= since));
        const ref = await getReferenceData(env);
        const playerById = new Map(ref.players.map((p) => [p.id, p]));
        const actorIdByEmail = new Map<string, string>();
        for (const p of ref.players) {
          if (p.email) actorIdByEmail.set(p.email.trim().toLowerCase(), p.id);
        }
        const missingIds = new Set<string>();
        for (const r of fresh) {
          if (r.playerId && !playerById.has(r.playerId)) missingIds.add(r.playerId);
        }
        for (const pid of missingIds) {
          try {
            const found = await people(env).getById(pid);
            if (found) playerById.set(pid, found);
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
          const actorEmail = r.actorEmail.trim().toLowerCase();
          const actorId = r.actorId ?? actorIdByEmail.get(actorEmail) ?? "";
          return {
            id: r.id,
            playerId: r.playerId,
            kind: r.kind,
            playerName: nameOf(r.playerId) || "Player",
            actorName: nameOf(actorId) || "Coach",
            oldRank: r.oldRank,
            newRank: r.newRank,
            note: r.justification,
            at: r.timestamp,
          };
        });
      } catch (err) {
        // Table not created yet: keep the documented graceful degradation to
        // an empty list. Every OTHER failure must propagate - silently
        // returning [] would render a data/API problem in the UI as
        // "No ranking changes recorded yet" (spec S5).
        if (err instanceof AirtableError && err.status === 404) {
          console.error("[RankingEvents] table not created yet (404):", err.message);
          return [];
        }
        console.error("[RankingEvents] read failed:", err);
        throw new HttpError(
          "Ranking changes are temporarily unavailable",
          502,
          "RANKING_EVENTS_UNAVAILABLE",
        );
      }
    },
    RANKING_EVENTS_TTL_MS,
  );
  return data;
}
