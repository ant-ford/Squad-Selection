import { format, parseISO, isValid } from 'date-fns';
import { hkDateKey } from '@shared/hkDateKey';

/** Hong Kong is UTC+8 all year; there is no daylight saving to account for. */
const HK_UTC_OFFSET_MINUTES = 8 * 60;

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

/**
 * Parse a fixture date the way the app means it.
 *
 * A bare calendar date ("2026-08-07") is a Hong Kong day - every date key in
 * the app comes from hkDateKey - so it is anchored to midnight in Hong Kong,
 * not the device's midnight. Left to parseISO, a device east of Hong Kong
 * (Sydney, Auckland) would put that midnight on the previous Hong Kong day
 * and the heading above a Saturday's fixtures would read Friday.
 *
 * Anything with a time is an instant and parses as one.
 */
function parseFixtureDate(dateStr: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return new Date(`${dateStr}T00:00:00+08:00`);
  return parseISO(dateStr);
}

/**
 * The same instant, re-expressed so that its LOCAL fields read as Hong Kong
 * wall-clock time. date-fns formats in the device's zone and has no way to
 * be told otherwise, so the date is shifted by the difference between the
 * two zones before it is formatted. Only the wall-clock fields are
 * meaningful on the result; it is never compared with anything.
 */
function asHongKongWallClock(d: Date): Date {
  return new Date(d.getTime() + (HK_UTC_OFFSET_MINUTES + d.getTimezoneOffset()) * 60_000);
}

/**
 * Format a fixture date in Hong Kong time, whatever zone the device is in.
 *
 * Match times are Hong Kong times, full stop. A player checking the app
 * from London or Sydney was shown the kick-off shifted into their own zone,
 * which read as the wrong time for a match they would be flying back for.
 * Locking the display to Hong Kong means the app always agrees with the
 * fixture list and with everyone else in the team chat.
 */
export function safeFormat(dateStr: string | undefined | null, fmt: string, fallback = '—'): string {
  if (!dateStr) return fallback;
  const d = parseFixtureDate(dateStr);
  return isValid(d) ? format(asHongKongWallClock(d), fmt) : fallback;
}

/**
 * True when the device is not on Hong Kong time, so a displayed time is
 * worth labelling. In Hong Kong the label would be noise on every card;
 * abroad it is the one word that stops "15:00" being read as local time.
 */
export function viewerIsOutsideHongKong(now = new Date()): boolean {
  return -now.getTimezoneOffset() !== HK_UTC_OFFSET_MINUTES;
}

/** "15:00" at home; "15:00 HKT" when the device is somewhere else. */
export function formatHkTime(dateStr: string | undefined | null, fallback = '—'): string {
  const time = safeFormat(dateStr, 'HH:mm', fallback);
  if (time === fallback) return time;
  return viewerIsOutsideHongKong() ? `${time} HKT` : time;
}

/** True when the fixture's Hong Kong day is before today's Hong Kong day. */
export function isPastFixture(dateStr: string, now = new Date()): boolean {
  if (!dateStr) return false;
  const d = parseFixtureDate(dateStr);
  if (!isValid(d)) return false;
  const fixtureKey = hkDateKey(d.toISOString());
  const todayKey = hkDateKey(now.toISOString());
  return !!fixtureKey && !!todayKey && fixtureKey < todayKey;
}
