import type { Env } from "./env";
import { getPlayersForMatch } from "./squad";
import { getReferenceData } from "./reference";
import { HttpError } from "./http";
import { ABILITY_RANK } from "../../shared/abilityRank";
import { playUpAllowance } from "./playUp";

export interface RecommendationCandidate {
  id: string;
  preferredName: string;
  playingPosition: string;
  playingAbility: string;
  playUpCount: number;
  /** U21s have a larger play-up allowance (Bye-Law 7.2(b), Sept 2026). */
  isU21?: boolean;
  /**
   * The team this candidate is RANKED as - getPlayersForMatch's display
   * team (Selected Team EOS -> SOS -> Registered Team), not necessarily
   * People.Registered Team. Named for the field it falls back to; see the
   * proximity score in buildRecommendations for why it is the display one.
   */
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
  options: { neededPosition?: string; limit?: number; includeSelected?: boolean } = {}
): Recommendation[] {
  const { neededPosition, limit, includeSelected } = options;

  // 1. Exclusion pass: Remove blocked, unavailable, or already selected players.
  //
  // `includeSelected` keeps the selected ones. The squad screen orders its
  // unselected rows by this ranking, and a player the coach has just taken
  // out of the squad is still Selected on the server until the save - so
  // without a rank of their own they sank below every ranked player, which
  // on a full club list looked like they had vanished.
  const filtered = pool.filter((p) => {
    if (p.eligibilityStatus === "blocked") return false;
    if (p.availabilityStatus === "Unavailable") return false;
    if (!includeSelected && p.selectionStatus === "Selected") return false;
    return true;
  });

  // 2. Score calculations
  const scored: Recommendation[] = filtered.map((p) => {
    // 2a. Ability Score (60 points max) - the dominant factor, about 2.5
    // points per grade. It was 50, which let the proximity score below
    // outweigh several grades: a D- shown in the team above ranked under G
    // players playing up.
    const rankValue = ABILITY_RANK[p.playingAbility] ?? 12; // Default to E+ if missing
    const abilityScore = (rankValue / 24) * 60;

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

    // 2c. Club Proximity Score (10 points max)
    //
    //   same team        10
    //   from above        8   (shown in a higher team, eligible here)
    //   playing up    10-3d   (d levels below the target team)
    //
    // A player shown above the target team used to get nothing here, which
    // is what buried them: they are eligible (blocked players never reach
    // this pool) and usually the strongest option. They now sit a notch
    // behind the target team's own players, so ability decides between them.
    //
    // Scored on the candidate's DISPLAY team - Selected Team EOS -> SOS ->
    // Registered Team, which is what getPlayersForMatch puts in this field.
    // That is a decision, not an oversight. When a Section Captain moves
    // someone to a new side for the season, People.Registered Team lags
    // behind: re-registration is separate, slower admin. Scoring on
    // Registered Team in the meantime ranks a player the club has been
    // fielding as a C as though they were a visiting D, and buries them
    // below the side they actually play for - which is the complaint this
    // ordering exists to answer.
    //
    // The BLOCKING rules go the other way and must stay that way:
    // eligibility, play-up counting and automatic re-registration all read
    // People.Registered Team (eligibility.ts, playerRanks), because those
    // are league obligations rather than optics. The same appearance can
    // therefore score as a same-team pick here and still count towards the
    // four-play-up limit there. Do not "align" the two.
    //
    // An unknown candidate team must not be treated as the target team: no
    // rank is invented for it, so it gets no proximity credit (and distance
    // stays 0, keeping the play-up logic neutral).
    const candidateTeamRank = teamRankMap[p.registeredTeam];
    let teamDistanceScore = 0;
    let distance = 0;
    if (candidateTeamRank !== undefined) {
      distance = candidateTeamRank - targetTeamRank;
      if (distance === 0) {
        teamDistanceScore = 10; // Same team context
      } else if (distance > 0) {
        teamDistanceScore = Math.max(0, 10 - distance * 3); // Play-up penalty scaling
      } else {
        teamDistanceScore = 8; // Shown in a higher team, eligible for this one
      }
    }

    // 2d. Play-Up Capacity Score (10 points max)
    const playUpCount = p.playUpCount ?? 0;
    const allowance = playUpAllowance({ u21Eligible: p.isU21 });
    let playUpScore = 10;
    if (distance > 0) {
      // Player is playing up from a lower tier squad -> reduce score based on
      // workload, relative to their own allowance: 3 points a play-up for
      // most players (10, 7, 4, 1), smaller steps across a U21's eight.
      playUpScore = Math.max(0, 10 - playUpCount * (9 / allowance));
    } else {
      // Registered in the target team or a higher team -> automatically gets full headroom points
      playUpScore = 10;
    }

    // Calculate baseline total score
    let totalScore = Math.round(abilityScore + positionScore + teamDistanceScore + playUpScore);

    // Heavily dock the score if a player has responded with "Maybe" 
    // Subtraction of 45 ensures they plummet below fully confirmed available options.
    if (p.availabilityStatus === "Maybe") {
      totalScore = Math.max(0, totalScore - 45);
    }

    // 3. Generate Advisory Tags (Cap at 3 max items)
    const reasons: string[] = [];
    if (rankValue >= 22) reasons.push("Top Ability");
    
    // Rebranded from "Fresh Legs" to "Play-Up Capacity" and limited strictly to lower-squad players
    if (distance > 0 && playUpCount <= allowance) {
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
      // Already the display value: getPlayersForMatch resolved it before
      // this pool was built, and it is what the score above was computed
      // from - so the coach sees the team the ranking actually used.
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
  limit?: number,
  includeSelected = false,
) {
  // Leverage existing getPlayersForMatch engine for eligibility checking
  const playerData = await getPlayersForMatch(env, matchId, side);
  if (!playerData || !playerData.match) {
    throw new Error("Match environment data could not be computed.");
  }
  const match = playerData.match;
  const targetTeamName = match.hkfcTeam;

  const ref = await getReferenceData(env);
  const teamRankMap = ref.teamRankMap || {};
  const targetTeamRank = teamRankMap[targetTeamName];
  if (targetTeamRank === undefined) {
    throw new HttpError(`Cannot determine team rank for "${targetTeamName}"`, 400);
  }

  const recommendations = buildRecommendations(playerData.players, targetTeamRank, teamRankMap, {
    neededPosition: position,
    limit: limit ?? 10,
    includeSelected,
  });

  return {
    matchId,
    side,
    targetPosition: position || null,
    recommendations,
  };
}