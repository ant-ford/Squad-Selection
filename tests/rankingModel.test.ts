import { describe, it, expect } from 'vitest';
import {
  applicantVisible, computeGroupBoundaries, countMoved, getGroupForRank, moveIdToRank, nameOf, parseRank,
  reorderIds, shortStage, stageOrdinal,
} from '../src/lib/rankingModel';
import { emptyConfig } from '../shared/abilityGroup';

describe('stages', () => {
  it('reads the stage number', () => {
    expect(stageOrdinal('1. Trial Application')).toBe(1);
    expect(stageOrdinal('4. Sponsor (Signed)')).toBe(4);
    expect(stageOrdinal('Accepted')).toBe(7);
    expect(stageOrdinal('')).toBe(-1);
    expect(stageOrdinal('Rejected')).toBe(-1);
  });
  it('drops the number for display', () => {
    expect(shortStage('1. Trial Application')).toBe('Trial Application');
    expect(shortStage(undefined)).toBe('');
  });
});

describe('ability groups', () => {
  const config = { ...emptyConfig(), A: 2, B: 3, C: 0, D: 2 };
  it('gives each configured group its ranks, skipping empty groups', () => {
    expect(computeGroupBoundaries(config, 20)).toEqual([
      { group: 'A', start: 1, end: 2 },
      { group: 'B', start: 3, end: 5 },
      { group: 'D', start: 6, end: 7 },
    ]);
  });
  it('stops at the number of active players', () => {
    expect(computeGroupBoundaries(config, 4)).toEqual([
      { group: 'A', start: 1, end: 2 },
      { group: 'B', start: 3, end: 4 },
    ]);
  });
  it('puts everyone past the last group in H', () => {
    const b = computeGroupBoundaries(config, 20);
    expect(getGroupForRank(1, b)).toBe('A');
    expect(getGroupForRank(5, b)).toBe('B');
    expect(getGroupForRank(8, b)).toBe('H');
  });
});

describe('nameOf', () => {
  it('prefers preferred name plus surname', () => {
    expect(nameOf({ preferredName: 'Sam', surname: 'Carter' })).toBe('Sam Carter');
    expect(nameOf({ preferredName: ' Sam ' })).toBe('Sam');
    expect(nameOf({ givenNames: 'Samuel' })).toBe('Samuel');
    expect(nameOf({})).toBe('Unknown');
  });
});

describe('reorder draft', () => {
  const ids = ['a', 'b', 'c', 'd'];
  it('moves a player before or after another', () => {
    expect(reorderIds(ids, 'd', 'b', true)).toEqual(['a', 'd', 'b', 'c']);
    expect(reorderIds(ids, 'a', 'c', false)).toEqual(['b', 'c', 'a', 'd']);
  });
  it('does nothing for the same player or an unknown target', () => {
    expect(reorderIds(ids, 'a', 'a', true)).toBeNull();
    expect(reorderIds(ids, 'a', 'z', true)).toBeNull();
  });
  it('moves a player to a rank', () => {
    expect(moveIdToRank(ids, 'd', 1)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveIdToRank(ids, 'a', 3)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveIdToRank(ids, 'a', 4)).toEqual(['b', 'c', 'd', 'a']);
  });
  it('clamps a rank outside the list', () => {
    expect(moveIdToRank(ids, 'b', 0)).toEqual(['b', 'a', 'c', 'd']);
    expect(moveIdToRank(ids, 'b', 99)).toEqual(['a', 'c', 'd', 'b']);
  });
  it('counts the players whose rank changed', () => {
    const server = new Map([['a', 1], ['b', 2], ['c', 3], ['d', 4]]);
    expect(countMoved(null, server)).toBe(0);
    expect(countMoved(ids, server)).toBe(0);
    expect(countMoved(['b', 'a', 'c', 'd'], server)).toBe(2);
    expect(countMoved(['d', 'a', 'b', 'c'], server)).toBe(4);
  });
});

describe('parseRank', () => {
  it('accepts whole numbers in range only', () => {
    expect(parseRank('1', 30)).toBe(1);
    expect(parseRank(' 30 ', 30)).toBe(30);
    expect(parseRank('0', 30)).toBeNull();
    expect(parseRank('31', 30)).toBeNull();
    expect(parseRank('2.5', 30)).toBeNull();
    expect(parseRank('', 30)).toBeNull();
    expect(parseRank('-3', 30)).toBeNull();
  });
});

describe('applicantVisible', () => {
  const both = { showTrial: true, showSponsoring: true };
  const none = { showTrial: false, showSponsoring: false };
  it('always shows members and accepted applicants', () => {
    expect(applicantVisible({ status: 'Active' }, none)).toBe(true);
    expect(applicantVisible({ status: 'Applicant', applicantStage: 'Accepted' }, none)).toBe(true);
  });
  it('never shows rejected applicants', () => {
    expect(applicantVisible({ status: 'Applicant', applicantStage: 'Rejected' }, both)).toBe(false);
  });
  it('follows the trial and sponsoring chips', () => {
    const trial = { status: 'Applicant', applicantStage: '1. Trial Application' };
    const sponsoring = { status: 'Applicant', applicantStage: '4. Sponsor (Signed)' };
    expect(applicantVisible(trial, { showTrial: false, showSponsoring: true })).toBe(false);
    expect(applicantVisible(sponsoring, { showTrial: false, showSponsoring: true })).toBe(true);
    expect(applicantVisible(sponsoring, { showTrial: true, showSponsoring: false })).toBe(false);
  });
});
