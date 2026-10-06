import { describe, expect, it } from 'vitest';
import { scoreInFixtureOrder } from '@/components/PastFixtureCard';

// Recent results read "Home vs Away" like the upcoming fixtures, so the score
// is home goals first; goalsFor/goalsAgainst are always HKFC's side.
describe('scoreInFixtureOrder', () => {
  it('keeps HKFC first when HKFC are at home', () => {
    expect(scoreInFixtureOrder({ isHome: true, goalsFor: 3, goalsAgainst: 1 })).toEqual([3, 1]);
  });

  it('puts the home side first when HKFC are away', () => {
    expect(scoreInFixtureOrder({ isHome: false, goalsFor: 1, goalsAgainst: 3 })).toEqual([3, 1]);
  });

  it('returns null until both goals are known', () => {
    expect(scoreInFixtureOrder({ isHome: true, goalsFor: null, goalsAgainst: 2 })).toBeNull();
    expect(scoreInFixtureOrder({ isHome: false, goalsFor: 0, goalsAgainst: null })).toBeNull();
  });
});
