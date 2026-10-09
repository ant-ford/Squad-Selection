import { byKickOff } from "./kickOff";
import { clashingGame, confirmedOf, hkTime, type UmpireDuty, type UmpiringBoard } from "./umpiring";

export const umpiringDutyIsPast = (duty: UmpireDuty, now = Date.now()): boolean =>
  Date.parse(duty.matchDate) + (duty.timeTbc ? 86_400_000 : 0) <= now;

export interface DutyAttention {
  duty: UmpireDuty;
  uncovered: boolean;
  conflicts: string[];
}

/** Upcoming work in the selected week, using only the viewer's permitted board data. */
export function umpiringAttention(board: UmpiringBoard, now = Date.now()): DutyAttention[] {
  const live = board.duties.filter((d) => d.status !== "cancelled" && !d.notNeeded);
  return live.flatMap((duty): DutyAttention[] => {
    if (umpiringDutyIsPast(duty, now)) return [];
    const taken = confirmedOf(duty);
    const uncovered = !taken || taken.status === "no_show";
    const conflicts: string[] = [];
    if (taken?.status === "confirmed") {
      const playing = taken.personId ? duty.clashes?.[taken.personId] : undefined;
      if (board.access === "coordinator" && playing) conflicts.push(`${taken.name} is playing at ${playing}`);
      // Reuse the existing same-ground/travel margins to catch overlapping umpiring assignments too.
      if (taken.personId) {
        const overlap = live.find((other) => other.id !== duty.id &&
          confirmedOf(other)?.status === "confirmed" && confirmedOf(other)?.personId === taken.personId &&
          clashingGame(duty, [other]));
        if (overlap) conflicts.push(`${taken.name} also umpiring ${overlap.timeTbc ? "at a time TBC" : `at ${hkTime(overlap.matchDate)}`} · ${overlap.homeTeam} vs ${overlap.awayTeam}`);
      }
    }
    // A viewer's game is relevant to an open duty or their own assignment, not somebody else's covered duty.
    if (board.me.isUmpire && duty.clash && (uncovered || taken?.personId === board.me.personId)) {
      conflicts.push(`Your game ${duty.clash}`);
    }
    return uncovered || conflicts.length ? [{ duty, uncovered, conflicts }] : [];
  }).sort((a, b) => byKickOff(a.duty.matchDate, b.duty.matchDate) || a.duty.slot - b.duty.slot || a.duty.id.localeCompare(b.duty.id));
}
