import { Env } from "./index";
import { getPlayersForMatch } from "./squad";
import { getReferenceData } from "./reference";
import { ABILITY_RANK } from "./abilityRank";

export interface RecommendationCandidate {
  id: string;
  preferredName: string;
  playingPosition: string;
  playingAbility: string;
  playUpCount: number;
  registeredTeam: string;
  eligibilityStatus: string;
  availabilityStatus: string;
  selectionStatus: string;
}

export interface Recommendation {
  id: string;
  preferredName: string;
  playingPosition: string;
  playingAbility: string;
  playUpCount: number;
  registeredTeam: string;
  eligibilityStatus: 'eligible' | 'warning' | 'blocked';
  score: number;
  reasons: string[];
}

export function buildRecommendations(
  pool: RecommendationCandidate[],
  targetTeamRank: number,
  teamRankMap: Record<string, number>,
  options: { neededPosition?: string; limit?: number } = {}
): Recommendation[] {
  const { neededPosition, limit } = options;

  // 1. Exclusion pass: Remove blocked, unavailable, or already selected players
  const filtered = pool.filter((p) => {
    if (p.eligibilityStatus === "blocked") return false;
    if (p.availabilityStatus === "Unavailable") return false;
    if (p.selectionStatus === "Selected") return false;
    return true;
  });

  // 2. Score calculations
  const scored: Recommendation[] = filtered.map((p) => {
    // 2a. Ability Score (50 points max)
    const rankValue = ABILITY_RANK[p.playingAbility] ?? 12; // Default to E+ if missing
    const abilityScore = (rankValue / 24) * 50;

    // 2b. Position Fit Score (20 points max)
    let positionScore = 0;
    if (neededPosition) {
      if (p.playingPosition === neededPosition) {
        positionScore = 20;
      } else if (p.playingPosition === "Flexible/Varies") {
        positionScore = 10;
      } else {
        positionScore = 0;
      }
    } else {
      positionScore = 20; // Neutral state: don't penalize anyone if no filter is set
    }

    // 2c. Club Proximity Score (20 points max) - WEIGHTING IS KEPT ACTIVE HERE
    const candidateTeamRank = teamRankMap[p.registeredTeam] ?? targetTeamRank;
    const distance = candidateTeamRank - targetTeamRank;
    let teamDistanceScore = 0;

    if (distance === 0) {
      teamDistanceScore = 20; // Same team context
    } else if (distance > 0) {
      teamDistanceScore = Math.max(0, 20 - distance * 5); // Play-up penalty scaling
    } else {
      teamDistanceScore = 0; // Play-down scenario
    }

    // 2d. Play-Up Capacity Score (10 points max)
    // UPDATE: Only apply play-up limits/penalization if the player belongs to a LOWER team (higher rank number)
    const playUpCount = p.playUpCount ?? 0;
    let playUpScore = 10;
    
    if (distance > 0) {
      // Player is playing up from a lower tier squad -> reduce score based on workload
      playUpScore = Math.max(0, 10 - playUpCount * 3);
    } else {
      // Registered in the target team or a higher team -> automatically gets full headroom points
      playUpScore = 10;
    }

    // Calculate baseline total score
    let totalScore = Math.round(abilityScore + positionScore + teamDistanceScore + playUpScore);

    // UPDATE: Heavily dock the score if a player has responded with "Maybe" 
    // Subtraction of 45 ensures they plummet below fully confirmed available options.
    if (p.availabilityStatus === "Maybe") {
      totalScore = Math.max(0, totalScore - 45);
    }

    // 3. Generate Advisory Tags (Cap at 3 max items)
    const reasons: string[] = [];
    if (rankValue >= 22) reasons.push("Top Ability");
    
    // UPDATE: Rebranded from "Fresh Legs" to "Play-Up Capacity" and limited strictly to lower-squad players
    if (distance > 0 && playUpCount < 4) {
      reasons.push("Play-Up Capacity");
    }
    
    if (neededPosition && p.playingPosition === neededPosition) {
      reasons.push("Perfect Position Match");
    } else if (neededPosition && p.playingPosition === "Flexible/Varies") {
      reasons.push("Versatile Choice");
    }
    
    // NOTE: "Club Proximity" reason tag block has been removed here so it isn't disclosed to coaches

    return {
      id: p.id,
      preferredName: p.preferredName,
      playingPosition: p.playingPosition,
      playingAbility: p.playingAbility,
      playUpCount: playUpCount,
      registeredTeam: p.registeredTeam,
      eligibilityStatus: p.eligibilityStatus as 'eligible' | 'warning' | 'blocked',
      score: totalScore,
      reasons: reasons.slice(0, 3),
    };
  });

  // 4. Stable Deterministic Sorting: Score (descending) -> Preferred Name (alphabetical ascending)
  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.preferredName.localeCompare(b.preferredName);
  });

  return limit !== undefined ? scored.slice(0, limit) : scored;
}

export async function getRecommendationsForMatch(
  env: Env,
  matchId: string,
  side?: "home" | "away",
  position?: string,
  limit?: number
) {
  // Leverage existing getPlayersForMatch engine for eligibility checking
  const playerData = await getPlayersForMatch(env, matchId, side);
  if (!playerData || !playerData.match) {
    throw new Error("Match environment data could not be computed.");
  }

  const match = playerData.match;
  const targetTeamName = side === "away" ? match.awayTeam : match.homeTeam;

  const ref = await getReferenceData(env);
  const teamRankMap = ref.teamRankMap || {};
  const targetTeamRank = teamRankMap[targetTeamName] ?? 12;

  const recommendations = buildRecommendations(playerData.players, targetTeamRank, teamRankMap, {
    neededPosition: position,
    limit: limit ?? 10,
  });

  return {
    matchId,
    side,
    targetPosition: position || null,
    recommendations,
  };
}