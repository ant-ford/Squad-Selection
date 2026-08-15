import type { UpcomingFixture } from '@/api/getUpcomingFixtures';

export type Readiness = 'ready' | 'attention' | 'critical';
export interface PositionNeed { position: 'GK' | 'DEF' | 'MID' | 'FWD'; count: number }
export interface SameDayConflict {
  date: string;
  playerId: string;
  playerName: string;
  teams: string[];
  /** Card ids (e.g. "recX-home"/"recX-away") of the two fixtures involved. */
  fixtureIds: string[];
}

export function daysUntil(dateStr: string): number {
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((d.getTime() - today.getTime()) / 86400000);
}

/** Club-default squad shape heuristic (tune here, used only for "Need X ×n"). */
export function expectedComposition(target: number): Record<'GK' | 'DEF' | 'MID' | 'FWD', number> {
  const gk = target >= 14 ? 2 : 1;
  const out = Math.max(0, target - gk);
  const def = Math.round(out * 0.36);
  const mid = Math.round(out * 0.36);
  return { GK: gk, DEF: def, MID: mid, FWD: out - def - mid };
}

export function missingPositions(f: UpcomingFixture): PositionNeed[] {
  const have = f.selectedPositionSummary ?? {};
  const want = expectedComposition(f.targetSquadSize);
  return (Object.keys(want) as Array<'GK' | 'DEF' | 'MID' | 'FWD'>)
    .map((position) => ({ position, count: want[position] - (have[position] ?? 0) }))
    .filter((n) => n.count > 0);
}

export function calculateTeamReadiness(f: UpcomingFixture): Readiness {
  const shortfall = f.targetSquadSize - f.selectedCount;
  const noGk = !(f.hasGoalkeeperSelected ?? (f.selectedPositionSummary?.GK ?? 0) > 0);
  if (noGk || shortfall >= 3 || (f.selectedUnavailableNames?.length ?? 0) > 0) return 'critical';
  if (shortfall >= 1 || f.maybeCount > 0) return 'attention';
  return 'ready';
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

export const severityOrder: Record<Readiness, number> = { critical: 0, attention: 1, ready: 2 };