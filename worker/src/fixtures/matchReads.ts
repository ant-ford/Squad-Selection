import { matches } from "../data/matches";
import type { Env } from "../env";
import { getVersioned } from "../cache";
import type { Match } from "../../../shared/schema/domainTypes";
import { hkDateKey } from "../../../shared/hkDateKey";
import { fixtureChange, FIXTURE_CHANGE_DAYS } from "../../../shared/fixtureChange";
import { currentSeason, previousSeason } from "../seasonContext";

/**
 * All Scheduled matches, with their selections, kept under the matches and
 * match_selections versions (cache.ts getVersioned): a squad save or an
 * hkha-sync result moves them, so no isolate shows an old squad. (On
 * 2026-09-23 a failed invalidation left a six-hour copy and the coach
 * dashboard showed 0/14 for a squad saved hours earlier; nothing needs
 * invalidating now.)
 */
const SCHEDULED_MATCHES_TTL_MS = 10 * 60 * 1000;

/**
 * Versioned so a deploy could retire a bad KV copy (2026-09-23), when this
 * read was still shared through KV.
 */
export const SCHEDULED_MATCHES_KEY = "scheduled-matches:v2";

export async function getScheduledMatches(env: Env): Promise<Match[]> {
  return getVersioned<Match[]>(env, SCHEDULED_MATCHES_KEY, ["matches", "match_selections"], async () => {
    return matches(env).listScheduled();
  }, SCHEDULED_MATCHES_TTL_MS);
}

export const CALLED_OFF_MATCHES_KEY = "called-off-matches:v1";

/**
 * Fixtures called off (postponed or cancelled) in the last 7 days, still
 * dated today or later. Only Scheduled matches are listed otherwise, so these
 * would vanish; the cards show them as "Postponed" for a week instead
 * (shared/fixtureChange.ts, migration 20261007160204).
 */
export async function getCalledOffMatches(env: Env): Promise<Match[]> {
  const all = await getVersioned<Match[]>(env, CALLED_OFF_MATCHES_KEY, ["matches"], async () => {
    const since = new Date(Date.now() - FIXTURE_CHANGE_DAYS * 86_400_000).toISOString();
    return matches(env).listCalledOffSince(since);
  }, SCHEDULED_MATCHES_TTL_MS);
  const today = hkDateKey(new Date().toISOString());
  return all.filter((m) => m.matchDate && hkDateKey(m.matchDate) >= today && fixtureChange(m) !== null);
}

/** How far back "show past" reaches on the coach fixture list. */
export const PAST_FIXTURE_WINDOW_DAYS = 28;

/**
 * Recently played matches, for the coach list's "Show past" toggle.
 *
 * A fixture stops being "Scheduled" the moment a result is entered, so
 * getScheduledMatches() cannot see last weekend's games however the caller
 * filters by date. That is why the toggle once appeared to do nothing: the
 * matches it was meant to reveal were never fetched.
 *
 * Bounded to the current season and the one before it. The unbounded
 * version - every Played match the club has ever recorded, a hundred at a
 * time - grew by a season's worth of pages every year, and the 28-day
 * window the caller applies can only ever straddle two seasons. Narrowing
 * to that window still happens in JS, at the caller.
 */
export async function getPlayedMatches(env: Env): Promise<Match[]> {
  const season = currentSeason();
  return getPlayedMatchesForSeasons(env, [season, previousSeason(season) || ""]);
}

/**
 * Played matches for two seasons, for the record and head-to-head shown on
 * the calendar feed.
 *
 * Separate from getPlayedMatches because that one is unbounded - every result
 * the club has ever recorded - and it pages 100 at a time. On the calendar
 * path, which already does a lot before it gets here, that unbounded scan was
 * enough to tip the whole request over its limits and return a 500. Two
 * seasons is all the FORM section can say anything about anyway.
 */
export async function getPlayedMatchesForSeasons(env: Env, seasons: string[]): Promise<Match[]> {
  const unique = [...new Set(seasons.filter(Boolean))].sort();
  if (unique.length === 0) return [];
  const key = `played-matches:${unique.join(",")}`;
  return getVersioned<Match[]>(env, key, ["matches", "match_selections"], async () => {
    return matches(env).listPlayedForSeasons(unique);
  }, SCHEDULED_MATCHES_TTL_MS);
}

/**
 * Played matches for two seasons with only what a team record reads, for
 * the calendar feeds' form lines (about half the bytes of
 * getPlayedMatchesForSeasons: no selections, kit or umpires).
 */
export async function getResultsForSeasons(env: Env, seasons: string[]): Promise<Match[]> {
  const unique = [...new Set(seasons.filter(Boolean))].sort();
  if (unique.length === 0) return [];
  return getVersioned<Match[]>(env, `results:${unique.join(",")}`, ["matches"], () => matches(env).listResultsForSeasons(unique));
}
