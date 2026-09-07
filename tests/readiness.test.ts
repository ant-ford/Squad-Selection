import { describe, it, expect } from 'vitest';
import { detectSameDayConflicts, playUpWatchLabel } from '../src/lib/readiness';
import type { UpcomingFixture } from '../src/api/getUpcomingFixtures';

const f = (over: Partial<UpcomingFixture>): UpcomingFixture => ({
  id: 'm1', date: '2026-08-10T19:00:00', homeTeam: 'HKFC C', awayTeam: 'Opp', hkfcTeam: 'HKFC C',
  opponent: 'Opp', isHome: true, division: 'D2', venue: 'HH', targetSquadSize: 16,
  selectedCount: 16, maybeCount: 0, unavailableCount: 0, ...over,
});

describe('detectSameDayConflicts', () => {
  it('flags double-selected players', () => {
    const a = f({ id: 'm1-home', selectedPlayers: [{ id: 'p1', name: 'John Smith' }] });
    const b = f({ id: 'm2-home', hkfcTeam: 'HKFC B', selectedPlayers: [{ id: 'p1', name: 'John Smith' }] });
    const c = detectSameDayConflicts([a, b]);
    expect(c).toHaveLength(1);
    expect(c[0].playerName).toBe('John Smith');
    expect(c[0].teams).toEqual(['HKFC C', 'HKFC B']);
    expect(c[0].fixtureIds).toEqual(['m1-home', 'm2-home']);
  });
  it('does not flag the home and away cards of the same match as a clash', () => {
    const same = detectSameDayConflicts([
      f({ id: 'm1-home', hkfcTeam: 'HKFC A', selectedPlayers: [{ id: 'p1', name: 'John Smith' }] }),
      f({ id: 'm1-away', hkfcTeam: 'HKFC B', selectedPlayers: [{ id: 'p1', name: 'John Smith' }] }),
    ]);
    expect(same).toHaveLength(0);
  });
  it('no conflict across different dates', () =>
    expect(detectSameDayConflicts([f({ id: 'a' }), f({ id: 'b', date: '2026-08-11T19:00:00' })])).toHaveLength(0));
});

describe('playUpWatchLabel', () => {
  it('maps counts', () => {
    expect(playUpWatchLabel(2).severity).toBe('warning');
    expect(playUpWatchLabel(3).label).toBe('Next appearance triggers re-registration');
    expect(playUpWatchLabel(4).label).toBe('Registration required');
  });
});
