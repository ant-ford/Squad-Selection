/**
 * Coaches act only on their own teams' matches (owner decision, 7 Oct 2026,
 * after the security review, PR #285). Section Captains and the Assistant
 * Director keep every team (auth.ts coachesEveryTeam).
 *
 * The routes still call requireCoach first; these narrow a coach to the
 * match, team or player the request names. Both reads below are the cached
 * ones the squad screens make anyway, so a check costs no extra round trip
 * once the screen has loaded, and nothing at all for those who coach every
 * team.
 */
import type { Env } from "./env";
import { HttpError } from "./http";
import { getVersioned } from "./cache";
import { matches } from "./data/matches";
import { getReferenceData } from "./reference";
import { resolveHkfcSide } from "./match";
import { coachesEveryTeam, coachesTeam, notYourTeam, type AuthorizedUser } from "./auth";
import type { Match } from "../../shared/schema/domainTypes";

/**
 * The raw match record, for READ endpoints and access checks; write paths
 * read it fresh. Kept under the matches and match_selections cache
 * versions (cache.ts getVersioned), which every squad save moves, so a
 * coach is never served the selections their save replaced, on any isolate.
 */
export async function getMatchRecord(env: Env, matchId: string): Promise<Match> {
  return getVersioned<Match>(env, `match:${matchId}`, ["matches", "match_selections"], async () => {
    const match = await matches(env).getById(matchId);
    if (!match) throw new HttpError("Match not found", 404);
    return match;
  });
}

/**
 * 403 NOT_YOUR_TEAM unless the coach coaches either HKFC side of the match.
 * A derby has two, and a coach of either may read the fixture and answer
 * for its players. 404 when there is no such match, as the routes answered
 * before.
 */
export async function requireCoachOfMatch(env: Env, user: AuthorizedUser, matchId: string): Promise<void> {
  if (coachesEveryTeam(user)) return;
  const match = await getMatchRecord(env, matchId);
  // Only HKFC team names are in coachTeams, so the opponent never matches.
  if (!coachesTeam(user, match.homeTeam) && !coachesTeam(user, match.awayTeam)) throw notYourTeam();
}

/**
 * 403 NOT_YOUR_TEAM unless the coach coaches the side a write goes to: a
 * squad save, the squad notice, the kit. The side is resolved the way
 * squad.ts resolves it (one that isn't an HKFC team falls back to the one
 * that is; none given means home in a derby), so in a derby each side
 * needs its own team.
 */
export async function requireCoachOfMatchSide(
  env: Env,
  user: AuthorizedUser,
  matchId: string,
  side: "home" | "away" | undefined,
): Promise<void> {
  if (coachesEveryTeam(user)) return;
  const [match, ref] = await Promise.all([getMatchRecord(env, matchId), getReferenceData(env)]);
  const resolved = resolveHkfcSide(match, new Set(Object.keys(ref.teamRankMap)), side);
  if (!coachesTeam(user, resolved === "home" ? match.homeTeam : match.awayTeam)) throw notYourTeam();
}
