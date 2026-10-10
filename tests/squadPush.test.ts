import { expect, it } from 'vitest';
import { squadPushMessage, type SquadPushResult } from '../shared/squadPush';

const empty: SquadPushResult = { players: 3, reached: 0, devices: 0 };

it('gives a useful next action for missing, expired and rejected registrations', () => {
  expect(squadPushMessage({ ...empty, people: 0 })).toMatch(/registered device.*off and back on/);
  expect(squadPushMessage({ ...empty, people: 3, devices: 3, pruned: 3 })).toMatch(/expired registrations/);
  expect(squadPushMessage({ ...empty, people: 3, devices: 3, pruned: 1 })).toMatch(/couldn't be delivered/);
  expect(squadPushMessage({ ...empty, people: 3, skipped: 3 })).toMatch(/sending limit/);
  expect(squadPushMessage({ ...empty, players: 0 })).toMatch(/Save your squad/);
});

it('shows partial success honestly and handles an older API without inventing a failure reason', () => {
  expect(squadPushMessage({ players: 3, reached: 1, devices: 2 })).toBe('Sent to 1 of 3 selected players');
  expect(squadPushMessage({ players: 1, reached: 1, devices: 1 })).toBe('Sent to 1 player');
  expect(squadPushMessage(empty)).toMatch(/Check that selected players/);
  expect(squadPushMessage(empty)).not.toMatch(/expired|sending limit|no selected players have/);
});
