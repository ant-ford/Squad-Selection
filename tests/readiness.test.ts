import { describe, it, expect } from 'vitest';
import { calculateTeamReadiness, missingPositions, detectSameDayConflicts, playUpWatchLabel } from '../src/lib/readiness';
import type { UpcomingFixture } from '../src/api/getUpcomingFixtures';

const f = (over: Partial<UpcomingFixture>): UpcomingFixture => ({
  id: 'm1', date: '2026-08-10T19:00:00', homeTeam: 'HKFC C', awayTeam: 'Opp', hkfcTeam: 'HKFC C',
  opponent: 'Opp', isHome: true, division: 'D2', venue: 'HH', targetSquadSize: 16,
  selectedCount: 16, availableCount: 0, maybeCount: 0, unavailableCount: 0, ...over,
});

describe('calculateTeamReadiness', () => {
  it('ready when full with GK', () =>
    expect(calculateTeamReadiness(f({ hasGoalkeeperSelected: true }))).toBe('ready'));
  it('attention when 2 short', () =>
    expect(calculateTeamReadiness(f({ selectedCount: 14, hasGoalkeeperSelected: true }))).toBe('attention'));
  it('critical when no GK', () =>
    expect(calculateTeamReadiness(f({ hasGoalkeeperSelected: false }))).toBe('critical'));
  it('critical when 3+ short', () =>
    expect(calculateTeamReadiness(f({ selectedCount: 13, hasGoalkeeperSelected: true }))).toBe('critical'));
  it('critical when selected player unavailable', () =>
    expect(calculateTeamReadiness(f({ hasGoalkeeperSelected: true, selectedUnavailableNames: ['Ben Chan'] }))).toBe('critical'));
});

describe('missingPositions', () => {
  it('reports GK and outfield gaps', () => {
    const needs = missingPositions(f({ selectedCount: 12, selectedPositionSummary: { GK: 1, DEF: 4, MID: 4, FWD: 3 } }));
    expect(needs).toContainEqual({ position: 'GK', count: 1 });
    expect(needs.find((n) => n.position === 'DEF')!.count).toBeGreaterThan(0);
  });
});

describe('detectSameDayConflicts', () => {
  it('flags double-selected players', () => {
    const a = f({ id: 'm1-home', selectedPlayers: [{ id: 'p1', name: 'John Smith' }] });
    const b = f({ id: 'm2-home', hkfcTeam: 'HKFC B', selectedPlayers: [{ id: 'p1', name: 'John Smith' }] });
    const c = detectSameDayConflicts([a, b]);
    expect(c).toHaveLength(1);
    expect(c[0].playerName).toBe('John Smith');
    expect(c[0].teams).toEqual(['HKFC C', 'HKFC B']);
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