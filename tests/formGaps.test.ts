import { describe, expect, it } from 'vitest';
import { focusGap, formGaps, gapSummary } from '../src/lib/formGaps';

describe('formGaps', () => {
  it('keeps the missing ones, in form order', () => {
    const gaps = formGaps([
      [true, { id: 'a', label: 'Games umpired' }],
      [false, { id: 'b', label: 'Practices' }],
      [true, { id: 'c', label: 'Sponsor' }],
    ]);
    expect(gaps.map((g) => g.id)).toEqual(['a', 'c']);
  });
});

describe('gapSummary', () => {
  it('lists the gaps in a sentence', () => {
    expect(gapSummary([])).toBe('');
    expect(gapSummary([{ id: 'a', label: 'Title' }])).toBe('Still needed: Title.');
    expect(gapSummary([{ id: 'a', label: 'Title' }, { id: 'b', label: 'Starts' }])).toBe('Still needed: Title and Starts.');
    expect(gapSummary([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }])).toBe('Still needed: A, B and C.');
  });
});

describe('focusGap', () => {
  const element = (control: boolean) => {
    const calls: string[] = [];
    const inner = { focus: () => calls.push('inner') };
    const el = {
      scrollIntoView: () => calls.push('scroll'),
      matches: () => control,
      querySelector: () => inner,
      focus: () => calls.push('self'),
    };
    return { el, calls };
  };

  it('scrolls to the control and focuses it', () => {
    const { el, calls } = element(true);
    expect(focusGap({ id: 'x', label: 'X' }, { getElementById: () => el as unknown as HTMLElement })).toBe(true);
    expect(calls).toEqual(['scroll', 'self']);
  });

  it('focuses the first control inside a group (ticks, a signature)', () => {
    const { el, calls } = element(false);
    focusGap({ id: 'x', label: 'X' }, { getElementById: () => el as unknown as HTMLElement });
    expect(calls).toEqual(['scroll', 'inner']);
  });

  it('does nothing without a gap or an element', () => {
    expect(focusGap(undefined, { getElementById: () => null })).toBe(false);
    expect(focusGap({ id: 'gone', label: 'X' }, { getElementById: () => null })).toBe(false);
  });
});
