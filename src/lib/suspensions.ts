/**
 * Pure helpers for the Suspensions screen (src/pages/Suspensions.tsx): the
 * "2 of 3 left" chip, each player's queue, the matches stepper and the
 * sheet's save.
 */
import type { StatusTone } from '@/lib/statusTone';
import type { LegacySuspensionRow, NewSuspension, SuspensionChange, SuspensionRow, SuspensionsBoard } from '@/api/suspensions';

/** The stepper's range; "Until cleared" is the other choice. */
export const MIN_MATCHES = 1;
export const MAX_MATCHES = 10;

/** The chip on an open suspension. */
export function leftLabel(s: Pick<SuspensionRow, 'matches' | 'remaining'>): { label: string; tone: StatusTone } {
  if (s.matches == null) return { label: 'Until cleared', tone: 'danger' };
  const left = Math.max(0, Math.min(s.matches, s.remaining ?? s.matches));
  return { label: `${left} of ${s.matches} left`, tone: left > 0 ? 'warning' : 'success' };
}

/**
 * Where each open suspension sits in its player's queue: they are served
 * one after another, in the order the API lists them. Only players with
 * more than one get a position.
 */
export function queuePositions(open: readonly Pick<SuspensionRow, 'id' | 'player'>[]): Map<string, { pos: number; of: number }> {
  const byPlayer = new Map<string, string[]>();
  for (const s of open) byPlayer.set(s.player, [...(byPlayer.get(s.player) ?? []), s.id]);
  const out = new Map<string, { pos: number; of: number }>();
  for (const ids of byPlayer.values()) {
    if (ids.length < 2) continue;
    ids.forEach((id, i) => out.set(id, { pos: i + 1, of: ids.length }));
  }
  return out;
}

/** "Next" for the one being served, "Then" for those waiting. */
export function queueLabel(q: { pos: number; of: number } | undefined): string | null {
  if (!q) return null;
  return q.pos === 1 ? `Serving 1 of ${q.of}` : `Queued ${q.pos} of ${q.of}`;
}

/** How a closed one ended, with its date. */
export function closedHow(s: Pick<SuspensionRow, 'clearedAt' | 'servedOn'>): { label: 'Cleared' | 'Served'; date: string | null } {
  if (s.clearedAt) return { label: 'Cleared', date: s.clearedAt };
  return { label: 'Served', date: s.servedOn };
}

/** One step of the stepper; null (until cleared) steps back to the top of the range. */
export function stepMatches(value: number | null, delta: 1 | -1): number {
  const from = value ?? MAX_MATCHES + (delta > 0 ? 0 : 1);
  return Math.min(MAX_MATCHES, Math.max(MIN_MATCHES, from + delta));
}

export interface SuspensionDraft {
  playerId: string | null;
  matches: number | null;
  fromDate: string;
  reason: string;
  /** Asked only when making an old flag a suspension; '' until chosen. */
  servingTeam?: string;
}

/** The reason 20261007130203_suspensions.sql gave the flags it moved. */
export const FLAG_REASON = 'Carried over from Is Suspended / Matches To Serve';

export function emptyDraft(today: string, playerId: string | null = null): SuspensionDraft {
  return { playerId, matches: 1, fromDate: today, reason: '' };
}

export function draftFrom(s: SuspensionRow): SuspensionDraft {
  return { playerId: s.player, matches: s.matches, fromDate: s.fromDate, reason: s.reason };
}

/**
 * An old flag as a suspension, from today: its matches to serve (within the
 * stepper's range), else until cleared, served by its team when it is one
 * of ours.
 */
export function draftFromFlag(flag: LegacySuspensionRow, today: string, teams: readonly string[]): SuspensionDraft {
  return {
    playerId: flag.player,
    matches: flag.matchesToServe && flag.matchesToServe > 0 ? Math.min(flag.matchesToServe, MAX_MATCHES) : null,
    fromDate: today,
    reason: FLAG_REASON,
    servingTeam: flag.team && teams.includes(flag.team) ? flag.team : '',
  };
}

/** What's missing before the sheet can save; null when ready. */
export function draftProblem(d: SuspensionDraft): string | null {
  if (!d.playerId) return 'Choose a player.';
  if (d.servingTeam === '') return 'Choose the serving team.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fromDate)) return 'Choose the start date.';
  if (!d.reason.trim()) return 'Give a reason.';
  return null;
}

/** A new suspension from a ready draft. */
export function newSuspension(d: SuspensionDraft): NewSuspension {
  return {
    playerId: d.playerId!,
    matches: d.matches,
    fromDate: d.fromDate,
    reason: d.reason.trim(),
    ...(d.servingTeam ? { servingTeam: d.servingTeam } : {}),
  };
}

/** Only what an edit changed; null when nothing did. */
export function suspensionChange(s: SuspensionRow, d: SuspensionDraft): SuspensionChange | null {
  const c: SuspensionChange = {};
  if (d.matches !== s.matches) c.matches = d.matches;
  if (d.fromDate !== s.fromDate) c.fromDate = d.fromDate;
  if (d.reason.trim() !== s.reason) c.reason = d.reason.trim();
  return Object.keys(c).length > 0 ? c : null;
}

/** Whether closing the sheet would lose something typed. */
export function isDirty(start: SuspensionDraft, d: SuspensionDraft): boolean {
  return (
    start.playerId !== d.playerId ||
    start.matches !== d.matches ||
    start.fromDate !== d.fromDate ||
    start.reason.trim() !== d.reason.trim() ||
    start.servingTeam !== d.servingTeam
  );
}

/** One person's part of the board, for their person page. */
export function personSuspensions(board: SuspensionsBoard, player: string) {
  return {
    open: board.open.filter((s) => s.player === player),
    cleared: board.cleared.filter((s) => s.player === player),
    card: board.cards.find((c) => c.player === player) ?? null,
    flag: board.legacy.find((l) => l.player === player) ?? null,
  };
}
