import type { AttendanceStatus } from '@/api/getPlayerAttendance';
import type { SquadPlayer } from '@/api/getTeamAttendance';
import type { StatusTone } from '@/lib/statusTone';

/** Players on the pitch: below this a side cannot be fielded from its own squad. */
export const MIN_SIDE = 11;

/**
 * Statuses that mean the player was, or is, there for this team: picked
 * or played, or available and not (yet) picked. A no-show was picked, so
 * counts here too - the cell is about who said yes, not who turned up.
 */
const COUNTED = new Set<AttendanceStatus>(['played', 'not-selected', 'no-show', 'selected', 'available']);

export interface SquadCount {
  /** Squad members available to this team for the fixture. */
  available: number;
  maybe: number;
}

/** How many of a squad are available for one of its fixtures. */
export function countSquad(players: readonly SquadPlayer[], matchId: string): SquadCount {
  let available = 0;
  let maybe = 0;
  for (const p of players) {
    const status = p.cells[matchId]?.status;
    if (!status) continue;
    if (COUNTED.has(status)) available++;
    else if (status === 'maybe') maybe++;
  }
  return { available, maybe };
}

/** Green with a full squad, amber with enough for a side, red below that. */
export function squadTone(available: number, targetSquadSize: number): StatusTone {
  if (available >= targetSquadSize) return 'success';
  if (available >= MIN_SIDE) return 'warning';
  return 'danger';
}

/**
 * The order the fixture detail lists its groups in: for an upcoming game,
 * what can still be acted on first; for a past one, what happened first.
 */
export function statusOrder(past: boolean): AttendanceStatus[] {
  return past
    ? ['played', 'not-selected', 'no-show', 'unavailable', 'elsewhere', 'off']
    : ['selected', 'available', 'maybe', 'unavailable', 'elsewhere', 'off'];
}
