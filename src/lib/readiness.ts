import type { UpcomingFixture } from '@/api/getUpcomingFixtures';
import { hkDateKey } from '@shared/hkDateKey';

export interface SameDayConflict {
  date: string;
  playerId: string;
  playerName: string;
  teams: string[];
  /** Card ids (e.g. "recX-home"/"recX-away") of the two fixtures involved. */
  fixtureIds: string[];
}

export function detectSameDayConflicts(fixtures: UpcomingFixture[]): SameDayConflict[] {
  const byDate = new Map<string, UpcomingFixture[]>();
  for (const f of fixtures) {
    // Group by the Hong Kong calendar day: an early kick-off is the previous
    // day in UTC, so slicing the ISO string would split or merge days wrongly.
    const day = hkDateKey(f.date);
    byDate.set(day, [...(byDate.get(day) ?? []), f]);
  }
  const out: SameDayConflict[] = [];
  for (const [date, list] of byDate) {
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        // Home/away cards of the SAME match share the same selected players;
        // comparing them would flag every selection as a clash.
        const baseId = (id: string) => id.replace(/-home$/, "").replace(/-away$/, "");
        if (baseId(list[i].id) === baseId(list[j].id)) continue;
        const bMap = new Map((list[j].selectedPlayers ?? []).map((sp) => [sp.id, sp.name]));
        for (const sp of list[i].selectedPlayers ?? [])
          if (bMap.has(sp.id))
            out.push({
              date,
              playerId: sp.id,
              playerName: sp.name,
              teams: [list[i].hkfcTeam, list[j].hkfcTeam],
              fixtureIds: [list[i].id, list[j].id],
            });
      }
  }
  return out;
}

