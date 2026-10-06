/**
 * The Men's Convenor's suspensions screen (worker/src/discipline.ts):
 * shapes shared by the Worker and the app.
 */

/** One suspension the Convenor recorded. */
export interface SuspensionRow {
  id: string;
  /** People api_id. */
  player: string;
  name: string;
  servingTeam: string;
  /** null = until cleared. */
  matches: number | null;
  /** Hong Kong date, YYYY-MM-DD. Fixtures on this date don't count. */
  fromDate: string;
  reason: string;
  /**
   * Fixtures served so far (league and cup, serving team, after fromDate).
   * A player's suspensions are served one after the other, so a later one
   * shows 0 until the one before it is done.
   */
  served: number;
  /** null = until cleared. 0 once served. */
  remaining: number | null;
  /** Still blocking selection: open and not yet served. */
  active: boolean;
  /**
   * Hong Kong date of the fixture that completed it. Set means served: it
   * closed itself and is listed under cleared, with clearedAt null.
   */
  servedOn: string | null;
  createdAt: string;
  createdBy: string | null;
  clearedAt: string | null;
  clearedBy: string | null;
  clearReason: string | null;
}

/** A suspension worked out from yellow cards (read-only here). */
export interface CardSuspensionRow {
  player: string;
  name: string;
  servingTeam: string | null;
  remainingMatches: number;
  points: number;
  dcReferral: boolean;
  /** A card's match or date is missing, so serving can't be counted. */
  indeterminate: boolean;
}

/** An old hand-set Is Suspended / Matches To Serve flag still in force. */
export interface LegacySuspensionRow {
  player: string;
  name: string;
  team: string | null;
  isSuspended: boolean;
  matchesToServe: number | null;
}

export interface SuspensionsBoard {
  /** Still to serve, in the order they will be served. */
  open: SuspensionRow[];
  /**
   * Cleared by the Convenor (clearedAt) or served (servedOn) in the last
   * CLEARED_DAYS days, newest first.
   */
  cleared: SuspensionRow[];
  cards: CardSuspensionRow[];
  legacy: LegacySuspensionRow[];
}

export const CLEARED_DAYS = 90;
export const MAX_SUSPENSION_MATCHES = 52;
export const MAX_SUSPENSION_REASON = 280;
