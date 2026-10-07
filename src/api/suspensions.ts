import { apiGet, apiPost } from '@/lib/apiClient';

/**
 * The Men's Convenor's suspensions (worker/src/discipline.ts, the
 * `discipline` section). The shapes mirror shared/discipline.ts on the API
 * side.
 */

/** One suspension the Convenor recorded. */
export interface SuspensionRow {
  id: string;
  /** People api id. */
  player: string;
  name: string;
  servingTeam: string;
  /** null = until cleared. */
  matches: number | null;
  /** Hong Kong date; fixtures on this date don't count. */
  fromDate: string;
  reason: string;
  /** League and cup matches served so far. A player's suspensions are served one after another. */
  served: number;
  /** null = until cleared. */
  remaining: number | null;
  /** Still blocking selection. */
  active: boolean;
  /** Set once served: listed under cleared. */
  servedOn: string | null;
  createdAt: string;
  createdBy: string | null;
  clearedAt: string | null;
  clearedBy: string | null;
  clearReason: string | null;
}

/** A suspension worked out from cards (read-only). */
export interface CardSuspensionRow {
  player: string;
  name: string;
  servingTeam: string | null;
  remainingMatches: number;
  points: number;
  dcReferral: boolean;
  indeterminate: boolean;
}

/** An old hand-set flag still in force. */
export interface LegacySuspensionRow {
  player: string;
  name: string;
  team: string | null;
  isSuspended: boolean;
  matchesToServe: number | null;
}

export interface SuspensionsBoard {
  /** In the order they will be served. */
  open: SuspensionRow[];
  /** Cleared or served in the last 90 days, newest first. */
  cleared: SuspensionRow[];
  cards: CardSuspensionRow[];
  legacy: LegacySuspensionRow[];
}

export interface NewSuspension {
  playerId: string;
  matches: number | null;
  fromDate: string;
  reason: string;
}

export type SuspensionChange = Partial<Pick<SuspensionRow, 'matches' | 'fromDate' | 'reason'>>;

export function getSuspensions(): Promise<SuspensionsBoard> {
  return apiGet('/api/discipline/suspension-list');
}

export function createSuspension(s: NewSuspension): Promise<{ ok: true; id: string }> {
  return apiPost('/api/discipline/suspensions', s);
}

export function updateSuspension(id: string, change: SuspensionChange): Promise<{ ok: true }> {
  return apiPost(`/api/discipline/suspensions/${encodeURIComponent(id)}`, change);
}

export function clearSuspension(id: string, reason?: string): Promise<{ ok: true }> {
  return apiPost(`/api/discipline/suspensions/${encodeURIComponent(id)}/clear`, reason ? { reason } : {});
}
