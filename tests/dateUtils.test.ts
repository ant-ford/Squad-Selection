import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { safeFormat, isPastFixture } from '../src/lib/dateUtils';

describe('dateUtils — safeFormat', () => {
  it('formats a valid ISO date string', () => {
    expect(safeFormat('2026-08-07T14:00:00', 'yyyy-MM-dd')).toBe('2026-08-07');
    expect(safeFormat('2026-08-07T14:00:00', 'EEE d MMM yyyy')).toBe('Fri 7 Aug 2026');
  });

  it('formats time portion', () => {
    expect(safeFormat('2026-08-07T14:30:00', 'HH:mm')).toBe('14:30');
  });

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

  it('handles date-only ISO strings', () => {
    expect(safeFormat('2026-08-07', 'yyyy-MM-dd')).toBe('2026-08-07');
  });
});

describe('dateUtils — isPastFixture', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true for a date in the past', () => {
    expect(isPastFixture('2026-08-06T19:00:00')).toBe(true);
  });

  it('returns false for today (same date)', () => {
    vi.setSystemTime(new Date('2026-08-07T12:00:00Z'));
    expect(isPastFixture('2026-08-07T19:00:00')).toBe(false);
  });

  it('returns false for a future date', () => {
    expect(isPastFixture('2026-08-08T19:00:00')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isPastFixture(undefined as unknown as string)).toBe(false);
  });

  it('returns false for an invalid date string', () => {
    expect(isPastFixture('bogus')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isPastFixture('')).toBe(false);
  });

  it('returns true for yesterday at any hour', () => {
    vi.setSystemTime(new Date('2026-08-07T00:05:00Z'));
    expect(isPastFixture('2026-08-06T23:59:00')).toBe(true);
  });

  it('handles dates in different format that parse correctly', () => {
    vi.setSystemTime(new Date('2026-08-07T12:00:00Z'));
    expect(isPastFixture('2026-08-06')).toBe(true);
    expect(isPastFixture('2026-08-09')).toBe(false);
  });
});