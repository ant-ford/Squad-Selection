import { describe, expect, it } from 'vitest';
import {
  SHEET_OVER,
  allowSheetClose,
  backStaysOnScreen,
  markedState,
  searchWith,
  searchWithout,
  sheetClosePlan,
  sheetLinkState,
  sheetOpenPlan,
  takeSheetClose,
} from '../src/lib/sheetParam';

const at = (pathname: string, search = '', state: unknown = null) => ({ pathname, search, state });

describe('searchWith / searchWithout', () => {
  it('sets one parameter and keeps the rest', () => {
    expect(searchWith('?team=Men%27s+A&view=needs', 'set', 'abc')).toBe("?team=Men%27s+A&view=needs&set=abc");
  });

  it('drops one parameter and keeps the rest', () => {
    expect(searchWithout('?team=B&set=abc&q=12', 'set')).toBe('?team=B&q=12');
  });

  it('leaves no stray question mark when nothing is left', () => {
    expect(searchWithout('?fixture=rec1', 'fixture')).toBe('');
  });
});

describe('sheetOpenPlan', () => {
  it('opening pushes a marked entry, keeping the other parameters', () => {
    expect(sheetOpenPlan(at('/kit', '?show=spare'), 'set', 's1')).toEqual({
      search: '?show=spare&set=s1',
      replace: false,
      state: { [SHEET_OVER]: '/kit' },
    });
  });

  it('keeps whatever else the entry had in its state', () => {
    const plan = sheetOpenPlan(at('/', '', { from: 'menu' }), 'fixture', 'rec1');
    expect(plan?.state).toEqual({ from: 'menu', [SHEET_OVER]: '/' });
  });

  it('defaults to "1" for a sheet with no id', () => {
    expect(sheetOpenPlan(at('/coach/match/rec9', '?side=home'), 'history', '1')?.search).toBe('?side=home&history=1');
  });

  it('swaps another value in place, keeping the mark', () => {
    const state = { [SHEET_OVER]: '/coach/ranking' };
    expect(sheetOpenPlan(at('/coach/ranking', '?stats=p1', state), 'stats', 'p2')).toEqual({
      search: '?stats=p2',
      replace: true,
      state,
    });
  });

  it('does nothing when that value is already open', () => {
    expect(sheetOpenPlan(at('/', '?fixture=rec1'), 'fixture', 'rec1')).toBeNull();
  });
});

describe('sheetClosePlan', () => {
  it('goes back over the entry the opening pushed', () => {
    expect(sheetClosePlan(at('/kit', '?set=s1', { [SHEET_OVER]: '/kit' }), 'set')).toEqual({ kind: 'back' });
  });

  it('a shared link or a fresh tab drops the parameter in place, keeping the rest', () => {
    expect(sheetClosePlan(at('/', '?event=e1&utm=wa'), 'event')).toEqual({ kind: 'replace', search: '?utm=wa', state: null });
  });

  it('does not go back when the mark is for another screen', () => {
    expect(sheetClosePlan(at('/coach/ranking', '?history=p1', { [SHEET_OVER]: '/' }), 'history').kind).toBe('replace');
  });

  it('does nothing when the sheet is already closed', () => {
    expect(sheetClosePlan(at('/', '?team=A', { [SHEET_OVER]: '/' }), 'fixture')).toEqual({ kind: 'none' });
  });

  it('open then close is a round trip to the same screen and parameters', () => {
    const before = at('/coach/ranking', '?team=B');
    const plan = sheetOpenPlan(before, 'attendance', 'p7')!;
    const opened = at(before.pathname, plan.search, plan.state);
    expect(sheetClosePlan(opened, 'attendance')).toEqual({ kind: 'back' });
    expect(new URLSearchParams(plan.search).get('team')).toBe('B');
  });
});

describe('marks', () => {
  it('only a mark for this screen counts', () => {
    expect(backStaysOnScreen(markedState(undefined, '/kit'), '/kit')).toBe(true);
    expect(backStaysOnScreen(markedState(undefined, '/kit'), '/')).toBe(false);
    expect(backStaysOnScreen(null, '/')).toBe(false);
    expect(backStaysOnScreen('text', '/')).toBe(false);
  });

  it('an in-app link to a sheet on this screen is marked; one to another screen is not', () => {
    expect(sheetLinkState('/?event=e1', '/')).toEqual({ [SHEET_OVER]: '/' });
    expect(sheetLinkState('/my-details?step=kit', '/')).toBeUndefined();
    expect(sheetLinkState('/', '/')).toBeUndefined();
  });
});

describe('the close allowance', () => {
  it('lets exactly one Back through', () => {
    expect(takeSheetClose()).toBe(false);
    allowSheetClose();
    expect(takeSheetClose()).toBe(true);
    expect(takeSheetClose()).toBe(false);
  });
});
