import { linkId } from "./airtable";
import type { Match, MatchCard, Player, SquadSelection, Team } from "../../src/generated/domainTypes";

// ── Public types ────────────────────────────────────────────────────────

export interface EligibilityResult {
  /** "eligible" | "warning" | "blocked" */
  status: "eligible" | "warning" | "blocked";
  /** Mandatory reason string per HKFC spec §16 when not eligible. */
  reason: string | null;
  /** Warnings surfaced only when status is not blocked. */
  warnings: string[];
  /** Current-season adjusted play-up count (excludes GK appearances). */
  playUpCount: number;
  /** Cross-team conflict: team name the player is already selected for today. */
  selectedByTeam: string | null;
  /** Cross-team conflict: higher team making the player unavailable today. */
  sameDayHigherTeam: string | null;
}

// ── Internal helpers ────────────────────────────────────────────────────

/** Map team name → Team (cached first load, rarely changes). */
type TeamMap = Map<string, Team>;
/** Map team name → TeamRank (number, lower = higher rank). */
type RankMap = Record<string, number>;

function isLeague(match: Match): boolean {
  return (match.competitionType || match.division || "").toLowerCase().includes("league") ||
         (!match.competitionType && !isCup(match));
}

function isCup(match: Match): boolean {
  const ct = (match.competitionType || match.division || "").toLowerCase();
  return ct.includes("cup") || ct.includes("plate") || ct.includes("bowl");
}

/** Determine HKFC team from match (whichever side has a known TeamRank). */
function hkfcTeamName(match: Match, rankMap: RankMap): string {
  const home = match.homeTeam || "";
  const away = match.awayTeam || "";
  if (rankMap[home] !== undefined) return home;
  return away;
}

function playerRanks(p: Player, rankMap: RankMap): { playerRank: number; isPremier: boolean } {
  const team = p.registeredTeam || "";
  const rank = rankMap[team] ?? 99;
  // Players registered to a Premier team have rank 1; alternatively check IsPremier on Teams.
  const isPremier = rank === 1;
  return { playerRank: rank, isPremier };
}

function teamRanks(teamName: string, teamMap: TeamMap, rankMap: RankMap): { rank: number; isPremier: boolean } {
  const rank = rankMap[teamName] ?? 99;
  const team = teamMap.get(teamName);
  const isPremier = team?.isPremier === true || rank === 1;
  return { rank, isPremier };
}

// ── Step 1: Admin Data Validation (§2.2) ────────────────────────────────

function checkAdminData(player: Player): string | null {
  if (!player.active) return "Admin data incomplete";
  if (!player.registeredTeam) return "Admin data incomplete";
  if (!player.playingPosition) return "Admin data incomplete";
  if (!player.playingAbility) return "Admin data incomplete";
  return null;
}

// ── Step 2: Suspension (§5) ─────────────────────────────────────────────

function checkSuspension(player: Player): string | null {
  if (player.isSuspended === true) return "Suspended";
  if ((player.matchesToServe ?? 0) > 0) return "Suspended";
  return null;
}

// ── Step 3: Visiting Player Restrictions (§6) ───────────────────────────

function checkVisitingPlayer(
  player: Player,
  targetHkfcTeam: string,
  match: Match,
  matchCards: MatchCard[],
  currentSeason: string,
): string | null {
  if (!player.isVisitingPlayer) return null;

  // §6.2 — Fixed to registered team
  if (player.registeredTeam !== targetHkfcTeam) {
    return "Visiting player — fixed to registered team";
  }

  // §6.3 — Cup eligibility: 5 league appearances for registered team
  if (isCup(match)) {
    const leagueApps = matchCards.filter((mc) => {
      const pId = linkId(mc.player);
      return (
        pId === player.id &&
        mc.team === player.registeredTeam &&
        mc.season === currentSeason &&
        (mc.match as any)?.competitionType !== undefined
          ? isLeague((mc.match as any) as Match)
          : true // best-effort: count all if we can't determine competition type
      );
    }).length;

    if (leagueApps < 5) {
      return "Visiting player — fewer than 5 appearances for registered team";
    }
  }

  return null;
}

// ── Step 4: Same-Day Movement (§7) ─────────────────────────────────────

function checkSameDayMovement(
  player: Player,
  targetHkfcTeam: string,
  targetRank: number,
  match: Match,
  rankMap: RankMap,
  sameDayMatches: Match[],
  allSelections: SquadSelection[],
  allExceptions: { playerId: string; matchId: string; status: string }[],
): { blockReason: string | null; selectedByTeam: string | null; sameDayHigherTeam: string | null } {
  let selectedByTeam: string | null = null;
  let sameDayHigherTeam: string | null = null;

  for (const sdm of sameDayMatches) {
    const sdmTeam = hkfcTeamName(sdm, rankMap);
    const sdmRank = rankMap[sdmTeam] ?? 99;

    // Cross-team selection visibility (independent of block)
    const sel = allSelections.find(
      (s) => linkId(s.player) === player.id && linkId(s.match) === sdm.id
    );
    if (sel && sdmTeam !== targetHkfcTeam) {
      selectedByTeam = sdmTeam;
    }

    // Only block for HIGHER-ranked teams (lower rank number)
    if (sdmRank >= targetRank) continue;

    // Check if player has an Unavailable exception for this higher team
    const hasException = allExceptions.some(
      (e) =>
        e.playerId === player.id &&
        e.matchId === sdm.id &&
        e.status === "Unavailable"
    );

    if (!hasException) {
      // Player IS available for higher-ranked team → block lower team
      return {
        blockReason: `Available for ${sdmTeam} on same day`,
        selectedByTeam,
        sameDayHigherTeam: sdmTeam,
      };
    }

    // Check if player is already Selected/Reserve by higher team
    const higherSel = allSelections.find(
      (s) => linkId(s.player) === player.id && linkId(s.match) === sdm.id
    );
    if (higherSel) {
      return {
        blockReason: `Selected for ${sdmTeam} on same day`,
        selectedByTeam: sdmTeam,
        sameDayHigherTeam: sdmTeam,
      };
    }

    sameDayHigherTeam = sdmTeam;
  }

  return { blockReason: null, selectedByTeam, sameDayHigherTeam };
}

// ── Step 5: Premier Division Restrictions (§8) ──────────────────────────

function checkPremierRestriction(
  player: Player,
  targetHkfcTeam: string,
  targetRank: number,
  targetIsPremier: boolean,
  matchCards: MatchCard[],
  currentSeason: string,
  teamMap: TeamMap,
): string | null {
  const { isPremier: playerIsPremier } = playerRanks(player, rankMapFromTeamMap(teamMap));

  // Only applies when crossing Premier ↔ non-Premier boundary
  const isPremierMovement = targetIsPremier !== playerIsPremier;
  if (!isPremierMovement) return null;

  // Count completed league matches for each team
  const targetCompleted = countCompletedMatches(targetHkfcTeam, matchCards, currentSeason);
  const playerCompleted = countCompletedMatches(
    player.registeredTeam || "",
    matchCards,
    currentSeason,
  );

  if (targetCompleted < 3 || playerCompleted < 3) {
    return "Premier movement restriction — team has not completed 3 matches";
  }

  return null;
}

function countCompletedMatches(teamName: string, matchCards: MatchCard[], season: string): number {
  // Count unique matches (by match link ID) where this team had players appear
  const matchIds = new Set<string>();
  for (const mc of matchCards) {
    if (mc.team === teamName && mc.season === season) {
      const mId = linkId(mc.match);
      if (mId) matchIds.add(mId);
    }
  }
  return matchIds.size;
}

function rankMapFromTeamMap(teamMap: TeamMap): RankMap {
  const rm: RankMap = {};
  for (const [name, t] of teamMap) {
    rm[name] = t.teamRank ?? 99;
  }
  return rm;
}

// ── Step 6: Play-Up Rules (§9-11, §13) ─────────────────────────────────

function checkPlayUpRules(
  player: Player,
  targetHkfcTeam: string,
  targetRank: number,
  playerRank: number,
  matchCards: MatchCard[],
  currentSeason: string,
): { blockReason: string | null; playUpCount: number } {
  const playUpCount = calculatePlayUpCount(player, matchCards, currentSeason);

  // §9.1 — Higher-to-lower movement blocked
  if (playerRank < targetRank) {
    return {
      blockReason: "Higher-to-lower movement requires Committee approval",
      playUpCount,
    };
  }

  // §9.2 / §13 — Lower-to-higher: play-up limit at 4
  if (targetRank < playerRank) {
    // Check for same-team selection (not a play-up if exactly same rank)
    if (playUpCount >= 4) {
      return {
        blockReason: "Play-up limit reached — re-registration required",
        playUpCount,
      };
    }
  }

  return { blockReason: null, playUpCount };
}

/**
 * Calculate adjusted play-up count (§10):
 * - Current season only
 * - Play Up? = true
 * - Excludes goalkeeper appearances (Goalkeeper = true AND Play Up? = true)
 * - Cups count toward the same quota
 */
function calculatePlayUpCount(
  player: Player,
  matchCards: MatchCard[],
  currentSeason: string,
): number {
  return matchCards.filter((mc) => {
    const pId = linkId(mc.player);
    if (pId !== player.id) return false;
    if (!mc.playUp) return false;
    if (mc.season !== currentSeason) return false;
    // §11.2 — GK exemption: exclude GK appearances from count
    if (mc.goalkeeper) return false;
    return true;
  }).length;
}

// ── Step 7: Cup Eligibility (§14) ──────────────────────────────────────

function checkCupEligibility(
  player: Player,
  match: Match,
  matchCards: MatchCard[],
  currentSeason: string,
  teamMap: TeamMap,
): string | null {
  if (!isCup(match)) return null;

  // §14.1 — Premier Division Cup Ban
  if (player.everRegisteredToPremier === true) {
    return "Cup ban — ever registered to Premier Division";
  }

  // §14.2 — Minimum 2 league appearances
  const leagueApps = matchCards.filter((mc) => {
    const pId = linkId(mc.player);
    return pId === player.id && mc.season === currentSeason;
  }).length;

  if (leagueApps < 2) {
    return "Fewer than 2 league appearances — ineligible for Cup";
  }

  // §14.3 — Cross-cup restriction
  const targetTeam = hkfcTeamName(match, rankMapFromTeamMap(teamMap));
  const otherTeamCupCard = matchCards.find((mc) => {
    const pId = linkId(mc.player);
    return (
      pId === player.id &&
      mc.team !== targetTeam &&
      mc.season === currentSeason
    );
  });

  if (otherTeamCupCard) {
    const otherTeam = otherTeamCupCard.team || "another team";
    return `Already played in a Cup for ${otherTeam} this season`;
  }

  return null;
}

// ── Step 8: U21 Double-Game Limits (§12.3) ─────────────────────────────

function checkU21DoubleGame(
  player: Player,
  targetHkfcTeam: string,
  match: Match,
  allSelections: SquadSelection[],
  sameDayMatches: Match[],
  playersById: Map<string, Player>,
): string | null {
  if (!player.u21Eligible) return null;

  // Only applies when playing for a different (higher) team
  if (targetHkfcTeam === player.registeredTeam) return null;

  // Count U21 double-game players already selected for target team today
  const targetMatchDate = match.matchDate;
  let u21DoubleGameCount = 0;

  for (const sel of allSelections) {
    const selMatchId = linkId(sel.match);
    const selPlayerId = linkId(sel.player);
    if (!selMatchId || !selPlayerId) continue;

    // Must be on the same day for the target team
    const selMatch = sameDayMatches.find((m) => m.id === selMatchId);
    if (!selMatch) continue;
    const selHkfcTeam = hkfcTeamName(selMatch, {});
    if (selHkfcTeam !== targetHkfcTeam) continue;

    const selPlayer = playersById.get(selPlayerId);
    if (!selPlayer?.u21Eligible) continue;

    // Check if this U21 is also selected for their registered team same day
    const hasRegTeamSelection = allSelections.some((rs) => {
      const rsPlayerId = linkId(rs.player);
      const rsMatchId = linkId(rs.match);
      if (rsPlayerId !== selPlayerId) return false;
      const rsMatch = sameDayMatches.find((m) => m.id === rsMatchId);
      if (!rsMatch) return false;
      return hkfcTeamName(rsMatch, {}) === selPlayer?.registeredTeam;
    });

    if (hasRegTeamSelection) {
      u21DoubleGameCount++;
    }
  }

  if (u21DoubleGameCount >= 3) {
    return "U21 double-game limit reached";
  }

  return null;
}

// ── Warnings (§16) ─────────────────────────────────────────────────────

function generateWarnings(
  player: Player,
  match: Match,
  playUpCount: number,
  matchCards: MatchCard[],
  currentSeason: string,
): string[] {
  const warnings: string[] = [];

  // Play-up approach warnings
  if (playUpCount === 2) {
    warnings.push("Second play-up appearance");
  } else if (playUpCount === 3) {
    warnings.push("Third play-up appearance");
  }

  // Visiting player early-season requirement at risk (§6.4)
  if (player.isVisitingPlayer) {
    const apps = matchCards.filter((mc) => {
      const pId = linkId(mc.player);
      return (
        pId === player.id &&
        mc.team === player.registeredTeam &&
        mc.season === currentSeason
      );
    }).length;
    if (apps < 5) {
      warnings.push("Visiting player early-season requirement at risk");
    }
  }

  return warnings;
}

// ── Main evaluation entry point ─────────────────────────────────────────

export interface EvaluationContext {
  /** Map team name → Team object. */
  teamMap: TeamMap;
  /** Map team name → TeamRank. */
  rankMap: RankMap;
  /** All same-day matches for conflict checking. */
  sameDayMatches: Match[];
  /** All SquadSelections across all matches today. */
  allSelections: SquadSelection[];
  /** Availability Exceptions indexed as { playerId, matchId, status }. */
  allExceptions: { playerId: string; matchId: string; status: string }[];
  /** Current-season Match Cards for all players. */
  matchCards: MatchCard[];
  /** Current season string (e.g. "2025-2026"). */
  currentSeason: string;
  /** Quick lookup: playerId → Player. */
  playersById: Map<string, Player>;
}

/**
 * Full eligibility evaluation following the HKFC Eligibility & Selection
 * Rules Specification v1.0 §4 evaluation order (8 steps + warnings).
 *
 * Steps are evaluated in sequence, short-circuiting on the first block.
 */
export function evaluatePlayerEligibility(
  player: Player,
  match: Match,
  ctx: EvaluationContext,
): EligibilityResult {
  const targetHkfcTeam = hkfcTeamName(match, ctx.rankMap);
  const { rank: targetRank, isPremier: targetIsPremier } = teamRanks(
    targetHkfcTeam, ctx.teamMap, ctx.rankMap
  );
  const { playerRank } = playerRanks(player, ctx.rankMap);

  // ── Step 1: Admin Data Validation ──
  const adminBlock = checkAdminData(player);
  if (adminBlock) {
    return {
      status: "blocked",
      reason: adminBlock,
      warnings: [],
      playUpCount: 0,
      selectedByTeam: null,
      sameDayHigherTeam: null,
    };
  }

  // ── Step 2: Suspension ──
  const suspensionBlock = checkSuspension(player);
  if (suspensionBlock) {
    return {
      status: "blocked",
      reason: suspensionBlock,
      warnings: [],
      playUpCount: 0,
      selectedByTeam: null,
      sameDayHigherTeam: null,
    };
  }

  // ── Step 3: Visiting Player ──
  const visitingBlock = checkVisitingPlayer(
    player, targetHkfcTeam, match, ctx.matchCards, ctx.currentSeason
  );
  if (visitingBlock) {
    return {
      status: "blocked",
      reason: visitingBlock,
      warnings: [],
      playUpCount: 0,
      selectedByTeam: null,
      sameDayHigherTeam: null,
    };
  }

  // ── Step 4: Same-Day Movement ──
  const sameDayResult = checkSameDayMovement(
    player, targetHkfcTeam, targetRank, match, ctx.rankMap,
    ctx.sameDayMatches, ctx.allSelections, ctx.allExceptions
  );
  if (sameDayResult.blockReason) {
    return {
      status: "blocked",
      reason: sameDayResult.blockReason,
      warnings: [],
      playUpCount: 0,
      selectedByTeam: sameDayResult.selectedByTeam,
      sameDayHigherTeam: sameDayResult.sameDayHigherTeam,
    };
  }

  // ── Step 5: Premier Division Restriction ──
  const premierBlock = checkPremierRestriction(
    player, targetHkfcTeam, targetRank, targetIsPremier,
    ctx.matchCards, ctx.currentSeason, ctx.teamMap
  );
  if (premierBlock) {
    return {
      status: "blocked",
      reason: premierBlock,
      warnings: [],
      playUpCount: 0,
      selectedByTeam: sameDayResult.selectedByTeam,
      sameDayHigherTeam: sameDayResult.sameDayHigherTeam,
    };
  }

  // ── Step 6: Play-Up Rules ──
  const playUpResult = checkPlayUpRules(
    player, targetHkfcTeam, targetRank, playerRank,
    ctx.matchCards, ctx.currentSeason
  );
  if (playUpResult.blockReason) {
    return {
      status: "blocked",
      reason: playUpResult.blockReason,
      warnings: [],
      playUpCount: playUpResult.playUpCount,
      selectedByTeam: sameDayResult.selectedByTeam,
      sameDayHigherTeam: sameDayResult.sameDayHigherTeam,
    };
  }

  // ── Step 7: Cup Eligibility ──
  const cupBlock = checkCupEligibility(
    player, match, ctx.matchCards, ctx.currentSeason, ctx.teamMap
  );
  if (cupBlock) {
    return {
      status: "blocked",
      reason: cupBlock,
      warnings: [],
      playUpCount: playUpResult.playUpCount,
      selectedByTeam: sameDayResult.selectedByTeam,
      sameDayHigherTeam: sameDayResult.sameDayHigherTeam,
    };
  }

  // ── Step 8: U21 Double-Game ──
  const u21Block = checkU21DoubleGame(
    player, targetHkfcTeam, match,
    ctx.allSelections, ctx.sameDayMatches, ctx.playersById
  );
  if (u21Block) {
    return {
      status: "blocked",
      reason: u21Block,
      warnings: [],
      playUpCount: playUpResult.playUpCount,
      selectedByTeam: sameDayResult.selectedByTeam,
      sameDayHigherTeam: sameDayResult.sameDayHigherTeam,
    };
  }

  // ── Generate Warnings ──
  const warnings = generateWarnings(
    player, match, playUpResult.playUpCount, ctx.matchCards, ctx.currentSeason
  );

  // U21 double-game limit approaching
  let u21Count = 0;
  // quick recount for warning threshold
  for (const sel of ctx.allSelections) {
    const selPlayerId = linkId(sel.player);
    const selMatchId = linkId(sel.match);
    if (!selPlayerId || !selMatchId) continue;
    const selMatch = ctx.sameDayMatches.find((m) => m.id === selMatchId);
    if (!selMatch) continue;
    const selTeam = hkfcTeamName(selMatch, ctx.rankMap);
    if (selTeam !== targetHkfcTeam) continue;
    const selPlayer = ctx.playersById.get(selPlayerId);
    if (!selPlayer?.u21Eligible) continue;
    const hasRegSel = ctx.allSelections.some((rs) => {
      const rp = linkId(rs.player);
      const rm = linkId(rs.match);
      if (rp !== selPlayerId) return false;
      const rmMatch = ctx.sameDayMatches.find((m) => m.id === rm);
      return rmMatch ? hkfcTeamName(rmMatch, ctx.rankMap) === selPlayer?.registeredTeam : false;
    });
    if (hasRegSel) u21Count++;
  }
  if (player.u21Eligible && u21Count >= 2) {
    warnings.push("U21 double-game limit approaching");
  }

  return {
    status: warnings.length > 0 ? "warning" : "eligible",
    reason: warnings.length > 0 ? warnings[0] : null,
    warnings,
    playUpCount: playUpResult.playUpCount,
    selectedByTeam: sameDayResult.selectedByTeam,
    sameDayHigherTeam: sameDayResult.sameDayHigherTeam,
  };
}
