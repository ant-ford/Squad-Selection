/**
 * Ranking Events - persisted audit trail for Section Rank changes, one row
 * per change (data/rankingEvents.ts):
 *
 *   player         the player whose rank changed
 *   actor          the coach / section captain who made the change
 *   actor email    verified session email (identity, spec 4.3)
 *   kind           move | reorder | activate | deactivate
 *   old/new rank   blank when none / when deactivated
 *   justification  optional note, max 280 chars
 *   timestamp      server-side, stamped at commit time
 */

import { people } from "./data/people";
import { rankingEvents, type RankingEventRow } from "./data/rankingEvents";
import type { Env } from "./env";
import { getPlayerByEmail } from "./reference";
import { HttpError } from "./http";
import { getCached, invalidateCachePrefix } from "./cache";

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
  await rankingEvents(env).create(rows);
  // The next read must reach the database immediately - never serve a stale
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

/** The changes a history list shows. */
const RECENT_CHANGES = 20;
/** Events read per page, newest first: a save records every player it shifted. */
const EVENTS_PAGE = 250;
/** Pages at most: enough for 20 moves even in a month of long reorders. */
const MAX_EVENT_PAGES = 6;

/**
 * The newest events since `since`, in whole saves, until they hold
 * RECENT_CHANGES moves once knock-on shifts are dropped: usually one read.
 * A full page's oldest timestamp may be a save cut in two, so it is read
 * again, whole, on the next page.
 */
async function recentSaves(env: Env, since: string): Promise<RankingEventRow[]> {
  const rows: RankingEventRow[] = [];
  let upTo: string | undefined;
  for (let page = 0; page < MAX_EVENT_PAGES; page++) {
    const batch = await rankingEvents(env).listRecent(since, EVENTS_PAGE, upTo);
    if (batch.length < EVENTS_PAGE) return [...rows, ...batch];
    const oldest = batch[batch.length - 1].timestamp;
    const whole = batch.filter((r) => r.timestamp !== oldest);
    // One save bigger than a page: keep what was read.
    if (whole.length === 0) return [...rows, ...batch];
    rows.push(...whole);
    upTo = oldest;
    if (withoutKnockOnShifts(rows).length >= RECENT_CHANGES) break;
  }
  return rows;
}

/**
 * Most recent ranking events within `days`, newest first, capped at the 20
 * newest. Only the window is read (not the whole table), and the names of
 * the players and coaches in the returned slice come from one lookup.
 */
export async function getRankingEvents(env: Env, days = 7): Promise<RankingChange[]> {
  const { data } = await getCached<RankingChange[]>(
    `ranking-events:${days}`,
    async () => {
      try {
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        const rows = await recentSaves(env, since);
        // Knock-on shifts come out before the cap, or one long move would
        // fill the 20 slots on its own.
        const shown = withoutKnockOnShifts(rows.filter((r) => r.timestamp !== "" && r.timestamp >= since)).slice(0, RECENT_CHANGES);
        if (shown.length === 0) return [];
        const actorEmailOf = (r: RankingEventRow) => r.actorEmail.trim().toLowerCase();
        const names = await people(env)
          .listNamesFor(
            shown.flatMap((r) => [r.playerId, ...(r.actorId ? [r.actorId] : [])]),
            shown.filter((r) => !r.actorId).map(actorEmailOf),
          )
          .catch((err) => {
            // Names are best-effort: the changes still show, as "Player" / "Coach".
            console.error("[RankingEvents] names not read:", err instanceof Error ? err.message : err);
            return [];
          });
        const byId = new Map(names.map((n) => [n.id, n]));
        const actorIdByEmail = new Map<string, string>();
        for (const n of names) if (n.email) actorIdByEmail.set(n.email, n.id);
        const nameOf = (id: string) => {
          const p = byId.get(id);
          if (!p) return "";
          return p.preferredName || p.givenNames || "Player";
        };
        return shown.map((r) => {
          const actorId = r.actorId ?? actorIdByEmail.get(actorEmailOf(r)) ?? "";
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
        // A failed read must not look like an empty history: silently
        // returning [] would render a data/API problem in the UI as
        // "No ranking changes recorded yet" (spec S5).
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
