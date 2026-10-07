import { UNRANKED_TEAM_RANK } from "../reference";
import type { Player } from "../../../shared/schema/domainTypes";
import type { ReferenceData } from "../reference";

// ---------------------------------------------------------------------------
// Lowest-ranked team Goalkeeper schedule
// ---------------------------------------------------------------------------

/**
 * Name of the lowest-ranked ACTIVE team: the team with the highest
 * `Teams.Team Rank` value. Never hardcoded - derived from live data each
 * call (reference data is itself cached 10 minutes).
 */
export function getLowestRankedTeamName(ref: ReferenceData): string {
  let lowest = "";
  let lowestRank = -Infinity;
  for (const t of ref.teams) {
    const rank = t.teamRank ?? UNRANKED_TEAM_RANK;
    if (rank > lowestRank) {
      lowestRank = rank;
      lowest = t.teamName || "";
    }
  }
  return lowest;
}

/**
 * Cohort: an ACTIVE player whose current Playing Position is Goalkeeper and
 * who is registered to the lowest-ranked active team. People.Playing
 * Position is the source of truth for current identity; Match Cards
 * Goalkeeper flags are historical and never used here.
 */
export function isSpecialGoalkeeper(user: Player, ref: ReferenceData): boolean {
  if (user.active !== true) return false;
  if ((user.playingPosition || "") !== "Goalkeeper") return false;
  const lowest = getLowestRankedTeamName(ref);
  return lowest !== "" && (user.registeredTeam || "") === lowest;
}
