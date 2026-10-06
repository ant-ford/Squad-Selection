import type { AbilityGroupConfigMap, InactiveRankingEntry, Player } from '@shared/schema/domainTypes';

/**
 * The ranking screen's pure logic: ability-group boundaries, applicant
 * stages and the reorder draft. Kept apart from the components so it can be
 * tested without a DOM.
 */

export const ABILITY_GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;
export const ACCEPTED_STAGE_ORDINAL = 7;

export interface GroupBoundary {
  group: string;
  start: number;
  end: number;
}

/** "3. Club Application (Signed)" -> 3; "Accepted" -> 7; unknown -> -1. */
export function stageOrdinal(stage?: string): number {
  if (!stage) return -1;
  if (stage === 'Accepted') return ACCEPTED_STAGE_ORDINAL;
  const m = /^(\d+)./.exec(stage);
  return m ? Number(m[1]) : -1;
}

/** "1. Trial Application" -> "Trial Application". */
export function shortStage(s?: string): string {
  return s ? s.replace(/^\d+.\s*/, '') : '';
}

/** The ranks each configured ability group covers, A first. H is the rest. */
export function computeGroupBoundaries(config: AbilityGroupConfigMap, totalActive: number): GroupBoundary[] {
  const boundaries: GroupBoundary[] = [];
  let cursor = 0;
  for (const g of ABILITY_GROUPS) {
    const cap = Math.max(0, Math.floor(config[g] ?? 0));
    if (cap === 0) continue;
    const start = cursor + 1;
    const end = Math.min(cursor + cap, totalActive);
    if (end < start) break;
    boundaries.push({ group: g, start, end });
    cursor = end;
  }
  return boundaries;
}

export function getGroupForRank(rank: number, boundaries: readonly GroupBoundary[]): string {
  for (const b of boundaries) if (rank >= b.start && rank <= b.end) return b.group;
  return 'H';
}

export function nameOf(p: Pick<Player | InactiveRankingEntry, 'preferredName' | 'surname' | 'givenNames'>): string {
  const a = (p.preferredName ?? '').trim();
  const b = (p.surname ?? '').trim();
  const c = (p.givenNames ?? '').trim();
  if (a && b) return `${a} ${b}`;
  return a || b || c || 'Unknown';
}

/** Moves `sourceId` next to `targetId` (before or after it). Unknown target: null. */
export function reorderIds(ids: readonly string[], sourceId: string, targetId: string, before: boolean): string[] | null {
  if (sourceId === targetId) return null;
  const next = ids.filter((id) => id !== sourceId);
  const ti = next.indexOf(targetId);
  if (ti === -1) return null;
  next.splice(before ? ti : ti + 1, 0, sourceId);
  return next;
}

/** Puts `id` at section rank `rank` (1-based), clamped to the list. */
export function moveIdToRank(ids: readonly string[], id: string, rank: number): string[] {
  const next = ids.filter((x) => x !== id);
  const index = Math.max(0, Math.min(Math.floor(rank) - 1, next.length));
  next.splice(index, 0, id);
  return next;
}

/** A typed rank, or null unless it is a whole number from 1 to `max`. */
export function parseRank(value: string, max: number): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= 1 && n <= max ? n : null;
}

export interface ApplicantVisibility {
  showTrial: boolean;
  showSponsoring: boolean;
}

/**
 * Whether a player shows under the applicant chips. Rejected applicants
 * never show; accepted ones always do; stage 1 follows "Trial", stages 2-6
 * follow "Sponsoring".
 */
export function applicantVisible(p: Pick<Player, 'status' | 'applicantStage'>, v: ApplicantVisibility): boolean {
  if (p.applicantStage === 'Rejected') return false;
  if (p.status !== 'Applicant') return true;
  const ord = stageOrdinal(p.applicantStage);
  if (ord === ACCEPTED_STAGE_ORDINAL) return true;
  return ord >= 2 ? v.showSponsoring : v.showTrial;
}

/** How many players the draft puts at a different rank from the server. */
export function countMoved(draftIds: readonly string[] | null, serverRankById: ReadonlyMap<string, number | undefined>): number {
  if (!draftIds) return 0;
  let count = 0;
  draftIds.forEach((id, i) => {
    if (serverRankById.has(id) && serverRankById.get(id) !== i + 1) count++;
  });
  return count;
}
