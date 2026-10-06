import { describe, it, expect } from 'vitest';
import { pruneDeltas, squadChanges, type SquadDelta } from '../src/lib/squadDelta';

const sel = (playerId: string): SquadDelta => ({ playerId, action: 'select' });
const rem = (playerId: string): SquadDelta => ({ playerId, action: 'remove' });

describe('squadChanges', () => {
  it('sends nothing when nothing is pending', () => {
    expect(squadChanges([], ['p1', 'p2'])).toEqual({ add: [], remove: [] });
  });

  it('splits pending actions into adds and removes', () => {
    expect(squadChanges([sel('p3'), rem('p1'), sel('p4')], ['p1', 'p2'])).toEqual({
      add: ['p3', 'p4'],
      remove: ['p1'],
    });
  });

  it('leaves out actions the squad already reflects', () => {
    // p2 is already in; p9 is already out.
    expect(squadChanges([sel('p2'), rem('p9'), sel('p3')], ['p1', 'p2'])).toEqual({ add: ['p3'], remove: [] });
  });

  it('uses the last action for a player', () => {
    expect(squadChanges([sel('p3'), rem('p3')], ['p1'])).toEqual({ add: [], remove: [] });
    expect(squadChanges([rem('p1'), sel('p1')], ['p1'])).toEqual({ add: [], remove: [] });
    expect(squadChanges([rem('p1'), sel('p1'), rem('p1')], ['p1'])).toEqual({ add: [], remove: ['p1'] });
  });

  it('never lists a player twice or in both lists', () => {
    const { add, remove } = squadChanges([sel('p3'), sel('p3'), rem('p1'), rem('p1')], ['p1']);
    expect(add).toEqual(['p3']);
    expect(remove).toEqual(['p1']);
  });

  it('accepts any iterable for the squad', () => {
    expect(squadChanges([rem('p1')], new Set(['p1']))).toEqual({ add: [], remove: ['p1'] });
  });
});

describe('pruneDeltas', () => {
  it('returns the same array when every action still changes something', () => {
    const deltas = [sel('p3'), rem('p1')];
    expect(pruneDeltas(deltas, ['p1', 'p2'])).toBe(deltas);
  });

  it('drops actions someone else already made', () => {
    // After a conflict: the other coach also added p3 and removed p2.
    const deltas = [sel('p3'), rem('p2'), sel('p4')];
    expect(pruneDeltas(deltas, ['p1', 'p3'])).toEqual([sel('p4')]);
  });

  it('keeps a pending add for a player someone else removed meanwhile', () => {
    expect(pruneDeltas([sel('p5')], ['p1'])).toEqual([sel('p5')]);
  });
});
