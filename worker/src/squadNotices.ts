/**
 * The coach's weekly loop (6 Oct 2026 review, item D4):
 *
 *  - "Changes since you notified": Notify keeps the squad as it stood when
 *    the coach sent it (squad_notices, migration 20261007160504). The squad
 *    page compares it with the squad now, and the fixture card shows a dot
 *    while they differ.
 *  - "Start from last squad": the same team's most recent earlier squad
 *    this season, for an empty squad to start from.
 */
import type { Env } from "./env";
import { HttpError } from "./http";
import { db, eq, inList } from "./data/supabase";
import type { Match } from "../../shared/schema/domainTypes";

export interface SquadNotice {
  /** When the coach last sent the squad (ISO). */
  at: string;
  /** The squad they sent, by player id. */
  squad: string[];
}

interface NoticeRow {
  match_id: string;
  side: "home" | "away";
  notified_at: string;
  squad: string[];
}

const SIDES = new Set(["home", "away"]);

/** POST /api/squad/notified {matchId, side}: the squad as it stands is what the players were told. */
export async function noteSquadNotified(env: Env, actorId: string, body: Record<string, unknown>): Promise<SquadNotice> {
  const matchId = typeof body.matchId === "string" ? body.matchId : "";
  const side = typeof body.side === "string" ? body.side : "";
  if (!/^[A-Za-z0-9-]{3,64}$/.test(matchId) || !SIDES.has(side)) throw new HttpError("Choose the fixture and side.", 400, "INVALID_INPUT");
  try {
    const r = await db(env).rpc<{ notifiedAt: string; squad: string[] }>("note_squad_notified", { p_match: matchId, p_side: side, p_actor: actorId });
    return { at: r.notifiedAt, squad: r.squad ?? [] };
  } catch (err) {
    if ((err as { code?: string }).code === "P0002") throw new HttpError("Fixture not found.", 404, "NOT_FOUND");
    throw err;
  }
}

/** The last notice for each of these fixtures' sides, keyed "matchId:side". */
export async function noticesForMatches(env: Env, matchIds: string[]): Promise<Map<string, SquadNotice>> {
  if (matchIds.length === 0) return new Map();
  const rows = await db(env).select<NoticeRow>("api_squad_notices", `select=match_id,side,notified_at,squad&match_id=${inList(matchIds)}`);
  return new Map(rows.map((r) => [`${r.match_id}:${r.side}`, { at: r.notified_at, squad: r.squad ?? [] }]));
}

/** One side's last notice, or null. */
export async function squadNotice(env: Env, matchId: string, side: "home" | "away"): Promise<SquadNotice | null> {
  const r = await db(env).one<NoticeRow>("api_squad_notices", `select=match_id,side,notified_at,squad&match_id=${eq(matchId)}&side=${eq(side)}`);
  return r ? { at: r.notified_at, squad: r.squad ?? [] } : null;
}

/** Whether the squad now differs from the one the players were sent. */
export function changedSinceNotice(notice: SquadNotice | null | undefined, selectedIds: readonly string[]): boolean {
  if (!notice) return false;
  const told = new Set(notice.squad);
  return told.size !== new Set(selectedIds).size || selectedIds.some((id) => !told.has(id));
}

/**
 * The same team's last squad before this fixture: the latest earlier match
 * this season where the team's side had players picked. Null when there's
 * none.
 */
export function previousSquad(
  matches: Iterable<Match>,
  match: Pick<Match, "id" | "matchDate">,
  team: string,
): { matchId: string; date: string; players: string[] } | null {
  let best: { matchId: string; date: string; players: string[] } | null = null;
  for (const m of matches) {
    if (m.id === match.id || !m.matchDate || !match.matchDate || m.matchDate >= match.matchDate) continue;
    const players = m.homeTeam === team ? m.selectedPlayersHome : m.awayTeam === team ? m.selectedPlayersAway : undefined;
    if (!players?.length) continue;
    if (!best || m.matchDate > best.date) best = { matchId: m.id, date: m.matchDate, players: [...players] };
  }
  return best;
}
