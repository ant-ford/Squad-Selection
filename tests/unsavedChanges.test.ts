import { describe, expect, it } from 'vitest';
import { askBeforeUnload, blocksNavigation } from '../src/lib/unsavedChanges';

const at = (pathname: string) => ({ pathname });

describe('blocksNavigation', () => {
  it('asks when leaving the page with unsaved changes', () => {
    expect(blocksNavigation({ dirty: true, from: at('/my-details'), to: at('/') })).toBe(true);
  });

  it('never asks with nothing unsaved', () => {
    expect(blocksNavigation({ dirty: false, from: at('/my-details'), to: at('/') })).toBe(false);
  });

  it('stays quiet for a change of search params on the same page (a step, a tab, a filter)', () => {
    expect(blocksNavigation({ dirty: true, from: at('/apply'), to: at('/apply') })).toBe(false);
  });

  it('lets a save that moves on through', () => {
    expect(blocksNavigation({ dirty: true, allowed: true, from: at('/joiners/new'), to: at('/joiners/abc') })).toBe(false);
  });
});

describe('askBeforeUnload', () => {
  it('cancels the unload and sets returnValue for older browsers', () => {
    let prevented = false;
    const event = { preventDefault: () => (prevented = true), returnValue: undefined as unknown };
    askBeforeUnload(event);
    expect(prevented).toBe(true);
    expect(event.returnValue).toBe('');
  });
});
