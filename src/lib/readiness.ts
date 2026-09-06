import type { UpcomingFixture } from '@/api/getUpcomingFixtures';

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
  for (const f of fixtures) byDate.set(f.date.slice(0, 10), [...(byDate.get(f.date.slice(0, 10)) ?? []), f]);
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

export function playUpWatchLabel(count: number): { label: string; severity: 'warning' | 'critical' } {
  if (count >= 4) return { label: 'Registration required', severity: 'critical' };
  if (count === 3) return { label: 'Next appearance triggers re-registration', severity: 'critical' };
  return { label: 'Approaching play-up limit', severity: 'warning' };
}
