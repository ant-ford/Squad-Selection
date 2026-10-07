/**
 * Kick-off order. A kick-off time not yet set (TBC) is stored as midnight
 * Hong Kong time, for matches and umpiring duties alike (hkha-sync), so a
 * plain sort on the date put every TBC game before the day's timed ones.
 * Here a TBC game goes after them, still on its own day.
 *
 * For lists shown in kick-off order only: nothing that picks "the first
 * game of the day" for a rule should switch to it.
 */
const HK_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** True for a midnight (00:00) Hong Kong kick-off, which is how TBC is stored. */
export function isTbcKickOff(iso: string): boolean {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  // Hong Kong has had no daylight saving since 1979 (as in hkDateKey).
  const ms = (((t + HK_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS;
  return ms < MINUTE_MS;
}

/** A number to sort by: a TBC kick-off counts as the end of its day. */
function kickOffKey(iso: string): number {
  const t = new Date(iso).getTime();
  return isTbcKickOff(iso) ? t + DAY_MS - 1 : t;
}

/**
 * Compares two kick-offs (ISO): earlier first, a TBC one after the timed
 * ones that day. A missing or unreadable date compares as text, as before.
 */
export function byKickOff(a: string | null | undefined, b: string | null | undefined): number {
  const x = a ? kickOffKey(a) : NaN;
  const y = b ? kickOffKey(b) : NaN;
  if (Number.isNaN(x) || Number.isNaN(y)) return (a ?? "").localeCompare(b ?? "");
  return x - y;
}
