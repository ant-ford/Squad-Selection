import { describe, expect, it } from 'vitest';
import { compareSeasons, precedingSeason } from '../src/lib/statsComparison';
import { SUMMARY_VERSION, type MatchResult, type SeasonSummary } from '../shared/clubStats';

const result = (date: string, home = 'HKFC A', away = 'Valley A', homeScore = 3, awayScore = 1): MatchResult => ({ date, home, away, homeScore, awayScore });
const summary = (season: string, results: MatchResult[]): SeasonSummary => ({
  version: SUMMARY_VERSION, season, generatedAt: '2026-10-01T00:00:00Z', results,
  matches: results.length, derbies: 0, teams: [], players: [], umpires: [],
  umpireSplits: { appointed: { w: 0, d: 0, l: 0 }, duty: { w: 0, d: 0, l: 0 }, unknown: { w: 0, d: 0, l: 0 } },
});

describe('Stats period comparisons', () => {
  it('compares the ongoing season through the same date, rather than a full previous year', () => {
    const current = summary('2026-2027', [result('2026-09-01'), result('2026-10-10'), result('2026-10-11')]);
    const previous = summary('2025-2026', [result('2025-09-01'), result('2025-10-10'), result('2025-10-11'), result('2026-04-01')]);
    const comparison = compareSeasons(current, previous, '2026-10-10')!;
    expect(comparison).toMatchObject({ toDate: true, currentThrough: '2026-10-10', previousThrough: '2025-10-10' });
    expect(comparison.current).toEqual({ games: 2, w: 2, d: 0, l: 0, gf: 6, ga: 2 });
    expect(comparison.previous).toEqual(comparison.current);
  });

  it('follows the July-to-June season when the cutoff is in the following calendar year', () => {
    const current = summary('2026-2027', [result('2026-06-30'), result('2026-07-01'), result('2027-01-31'), result('2027-02-01')]);
    const previous = summary('2025-2026', [result('2025-06-30'), result('2025-07-01'), result('2026-01-31'), result('2026-02-01')]);
    const comparison = compareSeasons(current, previous, '2027-01-31')!;
    expect(comparison.previousThrough).toBe('2026-01-31');
    expect(comparison.current.games).toBe(2);
    expect(comparison.previous.games).toBe(2);
  });

  it('excludes club derbies but counts each team’s own result, home or away', () => {
    const current = summary('2026-2027', [result('2026-09-01'), result('2026-09-02', 'KCC', 'HKFC A', 2, 0), result('2026-09-03', 'HKFC A', 'HKFC B', 0, 0)]);
    const previous = summary('2025-2026', []);
    expect(compareSeasons(current, previous, '2026-10-10')!.current).toEqual({ games: 2, w: 1, d: 0, l: 1, gf: 3, ga: 3 });
    expect(compareSeasons(current, previous, '2026-10-10', 'HKFC A')!.current).toEqual({ games: 3, w: 1, d: 1, l: 1, gf: 3, ga: 3 });
    expect(compareSeasons(current, previous, '2026-10-10', 'HKFC B')!.current).toEqual({ games: 1, w: 0, d: 1, l: 0, gf: 0, ga: 0 });
  });

  it('compares completed seasons in full, even after their calendar cutoff has passed', () => {
    const current = summary('2025-2026', [result('2025-10-01'), result('2026-06-30'), result('2026-07-01')]);
    const previous = summary('2024-2025', [result('2024-10-01'), result('2025-06-30')]);
    const comparison = compareSeasons(current, previous, '2026-10-10')!;
    expect(comparison).toMatchObject({ toDate: false, currentThrough: '2026-06-30', previousThrough: '2025-06-30' });
    expect(comparison.current.games).toBe(2);
    expect(comparison.previous.games).toBe(2);
  });

  it('clamps leap day to February 28 without including March games', () => {
    const current = summary('2027-2028', [result('2028-02-29')]);
    const previous = summary('2026-2027', [result('2027-02-28'), result('2027-03-01')]);
    const comparison = compareSeasons(current, previous, '2028-02-29')!;
    expect(comparison.previousThrough).toBe('2027-02-28');
    expect(comparison.previous.games).toBe(1);
  });

  it('keeps an empty period empty so the view can explain why no comparison is possible', () => {
    const current = summary('2026-2027', [result('2026-10-01')]);
    const previous = summary('2025-2026', [result('2025-11-01')]);
    expect(compareSeasons(current, previous, '2026-10-10')!.previous).toEqual({ games: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 });
  });

  it('refuses comparisons with another period, missing dates or incomplete older summaries', () => {
    const current = summary('2026-2027', [result('2026-10-01')]);
    const previous = summary('2025-2026', [result('2025-10-01')]);
    expect(precedingSeason(current.season)).toBe(previous.season);
    expect(compareSeasons(current, { ...previous, season: '2024-2025' }, '2026-10-10')).toBeNull();
    expect(compareSeasons(current, { ...previous, results: undefined }, '2026-10-10')).toBeNull();
    expect(compareSeasons(current, summary('2025-2026', [result('')]), '2026-10-10')).toBeNull();
    expect(compareSeasons(current, { ...previous, matches: 2 }, '2026-10-10')).toBeNull();
  });
});
