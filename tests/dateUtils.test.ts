import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { safeFormat, formatHkTime, isPastFixture, viewerIsOutsideHongKong } from '../src/lib/dateUtils';

// Match times are Hong Kong times, whatever zone the device is in. Node
// re-reads TZ on assignment, so each block below pins the "device" zone and
// expects the same Hong Kong wall-clock output from every one of them.
const ORIGINAL_TZ = process.env.TZ;

function inZone(tz: string, run: () => void) {
  describe(`device in ${tz}`, () => {
    beforeEach(() => {
      process.env.TZ = tz;
    });
    afterEach(() => {
      if (ORIGINAL_TZ === undefined) delete process.env.TZ;
      else process.env.TZ = ORIGINAL_TZ;
    });
    run();
  });
}

// 06:30 UTC is 14:30 in Hong Kong on the same day.
const KICK_OFF = '2026-08-07T06:30:00.000Z';
// 17:00 UTC on the 6th is 01:00 on the 7th in Hong Kong - the case a UTC or
// western device gets wrong by a whole day.
const EARLY_HOURS = '2026-08-06T17:00:00.000Z';

describe('dateUtils — safeFormat is pinned to Hong Kong time', () => {
  for (const tz of ['Asia/Hong_Kong', 'Europe/London', 'America/New_York', 'Australia/Sydney', 'UTC']) {
    inZone(tz, () => {
      it('formats the kick-off in Hong Kong wall-clock time', () => {
        expect(safeFormat(KICK_OFF, 'HH:mm')).toBe('14:30');
        expect(safeFormat(KICK_OFF, 'EEE d MMM yyyy')).toBe('Fri 7 Aug 2026');
        expect(safeFormat(KICK_OFF, 'yyyy-MM-dd')).toBe('2026-08-07');
      });

      it('puts a small-hours kick-off on its Hong Kong day', () => {
        expect(safeFormat(EARLY_HOURS, 'EEE d MMM')).toBe('Fri 7 Aug');
        expect(safeFormat(EARLY_HOURS, 'HH:mm')).toBe('01:00');
      });

      it('treats a bare date key as a Hong Kong calendar day', () => {
        // Date keys come from hkDateKey and head the fixture groups. A device
        // east of Hong Kong must not roll this back to the Thursday.
        expect(safeFormat('2026-08-07', 'EEEE d MMM')).toBe('Friday 7 Aug');
        expect(safeFormat('2026-08-07', 'yyyy-MM-dd')).toBe('2026-08-07');
      });
    });
  }

  it('returns fallback for undefined', () => {
    expect(safeFormat(undefined, 'yyyy-MM-dd')).toBe('—');
  });

  it('returns fallback for null', () => {
    expect(safeFormat(null, 'yyyy-MM-dd')).toBe('—');
  });

  it('returns fallback for empty string', () => {
    expect(safeFormat('', 'yyyy-MM-dd')).toBe('—');
  });

  it('returns fallback for invalid date', () => {
    expect(safeFormat('not-a-date', 'yyyy-MM-dd')).toBe('—');
  });

  it('returns custom fallback when provided', () => {
    expect(safeFormat(undefined, 'HH:mm', 'TBD')).toBe('TBD');
  });
});

describe('dateUtils — formatHkTime labels the zone only when it would otherwise mislead', () => {
  inZone('Asia/Hong_Kong', () => {
    it('shows a bare time at home', () => {
      expect(viewerIsOutsideHongKong()).toBe(false);
      expect(formatHkTime(KICK_OFF)).toBe('14:30');
    });
  });

  inZone('Europe/London', () => {
    it('adds HKT for a device somewhere else', () => {
      expect(viewerIsOutsideHongKong()).toBe(true);
      expect(formatHkTime(KICK_OFF)).toBe('14:30 HKT');
    });

    it('never labels the fallback', () => {
      expect(formatHkTime(undefined)).toBe('—');
      expect(formatHkTime('', 'TBD')).toBe('TBD');
    });
  });
});

describe('dateUtils — isPastFixture compares Hong Kong days', () => {
  // 2026-08-07 12:00 UTC is 20:00 on the 7th in Hong Kong.
  const now = new Date('2026-08-07T12:00:00Z');

  it('returns true for a date in the past', () => {
    expect(isPastFixture('2026-08-06T11:00:00Z', now)).toBe(true);
  });

  it('returns false for a fixture earlier today, even once it has kicked off', () => {
    expect(isPastFixture('2026-08-07T01:00:00Z', now)).toBe(false);
  });

  it('returns false for a future date', () => {
    expect(isPastFixture('2026-08-08T11:00:00Z', now)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isPastFixture(undefined as unknown as string, now)).toBe(false);
  });

  it('returns false for an invalid date string', () => {
    expect(isPastFixture('bogus', now)).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isPastFixture('', now)).toBe(false);
  });

  it('uses the Hong Kong day boundary, not UTC or the device', () => {
    // 17:00 UTC on the 6th is already the 7th in Hong Kong: today, not past.
    expect(isPastFixture('2026-08-06T17:00:00Z', now)).toBe(false);
    // 15:00 UTC on the 6th is 23:00 on the 6th in Hong Kong: yesterday.
    expect(isPastFixture('2026-08-06T15:00:00Z', now)).toBe(true);
  });

  it('handles bare date keys', () => {
    expect(isPastFixture('2026-08-06', now)).toBe(true);
    expect(isPastFixture('2026-08-07', now)).toBe(false);
    expect(isPastFixture('2026-08-09', now)).toBe(false);
  });

  it('defaults to the current time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      expect(isPastFixture('2026-08-06T11:00:00Z')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
