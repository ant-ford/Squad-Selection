import { describe, it, expect } from 'vitest';
import { isShortfallUrgent } from '../src/lib/readiness';

// Push-back Saturday 15:00 HKT = 07:00Z.
const pushBack = '2026-10-10T07:00:00.000Z';
const at = (iso: string) => new Date(iso);

describe('isShortfallUrgent', () => {
  it('is not urgent three days out', () => {
    expect(isShortfallUrgent(pushBack, at('2026-10-07T07:00:00Z'))).toBe(false);
  });

  it('is not urgent one minute before the 48-hour mark', () => {
    expect(isShortfallUrgent(pushBack, at('2026-10-08T06:59:00Z'))).toBe(false);
  });

  it('turns urgent 48 hours before push-back', () => {
    expect(isShortfallUrgent(pushBack, at('2026-10-08T07:00:00Z'))).toBe(true);
  });

  it('stays urgent on the morning of the match', () => {
    expect(isShortfallUrgent(pushBack, at('2026-10-10T01:00:00Z'))).toBe(true);
  });

  it('is not urgent once the match has started or been played', () => {
    expect(isShortfallUrgent(pushBack, at('2026-10-10T07:00:00Z'))).toBe(false);
    expect(isShortfallUrgent(pushBack, at('2026-10-12T07:00:00Z'))).toBe(false);
  });

  it('reads a +08:00 offset as the same instant', () => {
    expect(isShortfallUrgent('2026-10-10T15:00:00+08:00', at('2026-10-09T07:00:00Z'))).toBe(true);
  });

  it('is never urgent without a usable date', () => {
    expect(isShortfallUrgent('', at('2026-10-09T07:00:00Z'))).toBe(false);
    expect(isShortfallUrgent(null)).toBe(false);
    expect(isShortfallUrgent('not a date')).toBe(false);
  });
});
