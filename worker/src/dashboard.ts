import type { Env } from "./env";
import { getRankingEvents } from "./rankingEvents";

/**
 * Recent Section Rank changes, read from the Ranking Events table (newest
 * first). Degrades to an empty list when the table has not been created
 * yet - the dashboard never fails because the audit trail is missing.
 */
export async function getRecentChanges(env: Env, days: number) {
  // No catch: a failed Ranking Events read must surface as an API error, not
  // masquerade as "no changes" (spec S5). getRankingEvents logs the details
  // server-side and degrades to [] ONLY when the table does not exist yet.
  const changes = await getRankingEvents(env, days);
  return { changes };
}