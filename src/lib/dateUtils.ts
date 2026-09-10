import { format, parseISO, isValid } from 'date-fns';
import { hkDateKey } from '@shared/hkDateKey';

/**
 * Whole days from today to a fixture, counted in Hong Kong calendar days.
 *
 * Deliberately not a difference of timestamps: a 19:00 kick-off tonight and
 * a 09:00 one tomorrow morning are 14 hours apart, which rounds to "today"
 * either way if you divide by 24 hours. Players think in sleeps, so both
 * dates are collapsed to their Hong Kong day first and the subtraction
 * happens on those.
 *
 * Negative for a fixture already played. Null when the date is unusable.
 */
export function hkDaysUntil(dateStr: string | undefined | null, now = new Date()): number | null {
  const fixtureKey = hkDateKey(dateStr);
  const todayKey = hkDateKey(now.toISOString());
  if (!fixtureKey || !todayKey) return null;
  const fixtureDay = Date.parse(`${fixtureKey}T00:00:00Z`);
  const today = Date.parse(`${todayKey}T00:00:00Z`);
  if (Number.isNaN(fixtureDay) || Number.isNaN(today)) return null;
  return Math.round((fixtureDay - today) / 86_400_000);
}

/**
 * Short countdown for a fixture card: "Today", "Tomorrow", "in 5 days".
 * Past fixtures read "Yesterday" / "3 days ago" so the same label serves the
 * results view. Null when there is nothing sensible to say.
 */
export function countdownLabel(dateStr: string | undefined | null, now = new Date()): string | null {
  const days = hkDaysUntil(dateStr, now);
  if (days === null) return null;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1) return `in ${days} days`;
  return `${Math.abs(days)} days ago`;
}

export function safeFormat(dateStr: string | undefined | null, fmt: string, fallback = '—'): string {
  if (!dateStr) return fallback;
  const d = parseISO(dateStr);
  return isValid(d) ? format(d, fmt) : fallback;
}

export function isPastFixture(dateStr: string): boolean {
  if (!dateStr) return false;
  const d = parseISO(dateStr);
  if (!isValid(d)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}