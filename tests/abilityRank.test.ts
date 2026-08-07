import { describe, it, expect } from 'vitest';
import { ABILITY_RANK } from '../worker/src/abilityRank';

describe('ABILITY_RANK', () => {
  it('ranks A+ highest and H- lowest', () => {
    expect(ABILITY_RANK['A+']).toBe(24);
    expect(ABILITY_RANK['H-']).toBe(1);
  });

  it('maintains monotonic descending order from A+ to H-', () => {
    const entries = Object.entries(ABILITY_RANK).sort(([, a], [, b]) => b - a);
    const expectedOrder = [
      'A+', 'A', 'A-', 'B+', 'B', 'B-',
      'C+', 'C', 'C-', 'D+', 'D', 'D-',
      'E+', 'E', 'E-', 'F+', 'F', 'F-',
      'G+', 'G', 'G-', 'H+', 'H', 'H-',
    ];
    expect(entries.map(([k]) => k)).toEqual(expectedOrder);
  });

  it('ranks A above B (same tier, different groups)', () => {
    expect(ABILITY_RANK['A']).toBeGreaterThan(ABILITY_RANK['B']);
  });

  it('ranks C+ above C and C (intra-group +/neutral/-)', () => {
    expect(ABILITY_RANK['C+']).toBeGreaterThan(ABILITY_RANK['C']);
    expect(ABILITY_RANK['C']).toBeGreaterThan(ABILITY_RANK['C-']);
  });

  it('ranks B- above C+ (higher group beats lower group)', () => {
    expect(ABILITY_RANK['B-']).toBeGreaterThan(ABILITY_RANK['C+']);
  });

  it('has exactly 24 entries (A–H × 3 sub-groups)', () => {
    expect(Object.keys(ABILITY_RANK)).toHaveLength(24);
  });

  it('all values are positive integers', () => {
    for (const v of Object.values(ABILITY_RANK)) {
      expect(v).toBeGreaterThan(0);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});