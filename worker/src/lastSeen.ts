/**
 * When each person last opened Eddy (people.last_seen_at), for the squad
 * screen's "not seen 6 wks" mark and the July rollover's list of players
 * not seen since January (6 Oct 2026 review, items D5 and E1). The database
 * stamps it at sign-in, at most once a Hong Kong day (auth_context,
 * migration 20261007160104).
 */

/**
 * Whole weeks since a player last opened Eddy, when that is six or more and
 * they haven't answered this fixture; null otherwise. A player not seen
 * since stamping began isn't marked: there's nothing to go on yet.
 */
export function notSeenWeeks(lastSeenAt: string | undefined, answered: boolean, now = new Date()): number | null {
  if (answered || !lastSeenAt) return null;
  const days = (now.getTime() - new Date(lastSeenAt).getTime()) / 86_400_000;
  return Number.isFinite(days) && days >= 42 ? Math.floor(days / 7) : null;
}
