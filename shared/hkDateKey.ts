/**
 * Calendar-day key in Asia/Hong_Kong, never UTC. A 03:00 HKT kick-off is
 * 19:00 UTC the PREVIOUS day, so grouping fixtures or evaluating same-day
 * rules by the UTC date would put an early-morning match on the wrong day.
 * Single authoritative definition - every same-day grouping in the app
 * (worker and frontend) must go through this, not a raw `.split("T")[0]`.
 *
 * It runs thousands of times per dashboard render, so it does plain UTC+8
 * arithmetic: Hong Kong has had no daylight saving since 1979. Anything
 * outside 1980-9999 goes through the shared formatter, which knows the
 * history. Building a formatter per call cost ~40x as much.
 */
const HK_FORMAT = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" });
const HK_OFFSET_MS = 8 * 60 * 60 * 1000;
const FIXED_OFFSET_FROM = Date.UTC(1980, 0, 1);
const FIXED_OFFSET_TO = Date.UTC(9999, 0, 1);

export function hkDateKey(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  if (t < FIXED_OFFSET_FROM || t >= FIXED_OFFSET_TO) return HK_FORMAT.format(t);
  return new Date(t + HK_OFFSET_MS).toISOString().slice(0, 10);
}

/*
 * Arithmetic on day keys ("YYYY-MM-DD"). A key is already a calendar date
 * (in Hong Kong time when it came from hkDateKey), so this is plain date
 * arithmetic at UTC midnight: no time zone can move it to another day.
 */

/** The day key `n` days after `dayKey` (before it when `n` is negative). */
export function addDays(dayKey: string, n: number): string {
  return new Date(Date.parse(`${dayKey}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from one day key to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
