/**
 * Which seasons "All time" on the Stats page asks for, and when it has
 * them all (useAllSeasonStats in queries.ts). Pure, so it can be tested
 * without React.
 *
 * Seasons are newest first. Up to ALL_TIME_CONCURRENCY are requested at
 * once, ahead of the newest-first run of seasons already loaded. History
 * ends after two empty seasons in a row once a season with games has been
 * seen (a single empty one can be a gap), or at the end of the list. A
 * request or two past the end may already be out by then; that is the
 * price of not waiting for each season in turn.
 */

/** Seasons requested at once: a past season's first view makes the Worker build it. */
export const ALL_TIME_CONCURRENCY = 4;

export interface AllTimePlan {
  /** Seasons [0, fetchUpTo) may be requested. */
  fetchUpTo: number;
  /** The seasons that count: [0, counted). */
  counted: number;
  /** History has ended and every counted season is loaded. */
  done: boolean;
}

/** `matches[i]`: season i's match count, or undefined while it isn't loaded. */
export function allTimePlan(matches: (number | undefined)[], concurrency = ALL_TIME_CONCURRENCY): AllTimePlan {
  const total = matches.length;
  let seenData = false;
  let i = 0;
  for (; i < total; i++) {
    const m = matches[i];
    if (m === undefined) break;
    if (m > 0) seenData = true;
    if (seenData && i >= 1 && m === 0 && matches[i - 1] === 0) {
      return { fetchUpTo: i + 1, counted: i + 1, done: true };
    }
  }
  // i: how many seasons from the newest are loaded without a gap.
  if (i === total) return { fetchUpTo: total, counted: total, done: true };
  return { fetchUpTo: Math.min(total, i + Math.max(1, concurrency)), counted: i, done: false };
}
