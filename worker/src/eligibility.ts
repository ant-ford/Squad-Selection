import { linkId } from "./airtable";
import type { Match, MatchCard, Player, SquadSelection, Team } from "../../src/generated/domainTypes";

// ── Public types ────────────────────────────────────────────────────────

/**
 * Reasoning tag attached to every eligibility result, providing coaches
 * with the specific bye-law or HKFC interpretation that applies.
 */
export interface EligibilityReasonTag {
  /** Human-readable short label (e.g. "Bye-Law 7.2(a)"). */
  source: string;
  /** The actual text of the bye-law or HKFC interpretation. */
  text: string;
  /** Whether this is an HKFC operational override of the standard bye-law. */
  isHkfcOverride: boolean;
}

export interface EligibilityResult {
  /** "eligible" | "warning" | "blocked" */
  status: "eligible" | "warning" | "blocked";
  /** Mandatory reason string per HKFC spec §16 — only non-null when blocked. */
  reason: string | null;
  /** Warnings surfaced only when status is not blocked. */
  warnings: string[];
  /** Current-season adjusted play-up count (excludes GK appearances). */
  playUpCount: number;
  /** Cross-team conflict: team name the player is already selected for today. */
  selectedByTeam: string | null;
  /** Cross-team conflict: higher team making the player unavailable today. */
  sameDayHigherTeam: string | null;
  /** Source reference for the reason (bye-law or HKFC interpretation). */
  reasonTag: EligibilityReasonTag | null;
  /** Source references for each warning. */
  warningTags: EligibilityReasonTag[];
}

// ── Internal helpers ────────────────────────────────────────────────────

type TeamMap = Map<string, Team>;
type RankMap = Record<string, number>;
type Exception = { playerId: string; matchId: string; status: string };

function buildRankMap(teamMap: TeamMap): RankMap {
  const rm: RankMap = {};
  for (const [name, t] of teamMap.entries()) {
    rm[name] = t.teamRank ?? 99;
  }
  return rm;
}

function safeLinkId(value: unknown): string | null {
  try {
    const id = linkId(value);
    return id || null;
  } catch {
    return null;
  }
}

function isLeague(match: Match): boolean {
  return (
    (match.competitionType || match.division || "")
      .toLowerCase()
      .includes("league") ||
    (!match.competitionType && !isCup(match))
  );
}

function isCup(match: Match): boolean {
  const ct = (match.competitionType || match.division || "").toLowerCase();
  return ct.includes("cup") || ct.includes("plate") || ct.includes("bowl");
}

/**
 * Return HKFC team name for a match; prefer a team present in rankMap;
 * returns null if neither side has a known team rank.
 */
function hkfcTeamNameSafe(match: Match, rankMap: RankMap): string | null {
  const home = match.homeTeam || "";
  const away = match.awayTeam || "";
  if (rankMap[home] !== undefined) return home;
  if (rankMap[away] !== undefined) return away;
  if (home) return home;
  if (away) return away;
  return null;
}

function playerRanks(
  p: Player,
  rankMap: RankMap,
): { playerRank: number; isPremier: boolean } {
  const team = p.registeredTeam || "";
  const rank = rankMap[team] ?? 99;
  const isPremier = rank === 1;
  return { playerRank: rank, isPremier };
}

function teamRanks(
  teamName: string,
  rankMap: RankMap,
  teamMap: TeamMap,
): { rank: number; isPremier: boolean } {
  const rank = rankMap[teamName] ?? 99;
  const team = teamMap.get(teamName);
  const isPremier = team?.isPremier === true || rank === 1;
  return { rank, isPremier };
}

// ── Bye-Law & HKFC Interpretation Reference Library ─────────────────────

/**
 * Centralised map of reason strings → their authoritative sources.
 * Each entry cites the relevant bye-law section and/or the HKFC operational
 * interpretation recorded in the Eligibility & Selection Rules Spec.
 */
const REASON_TAGS: Record<string, EligibilityReasonTag> = {
  // ── Blocked reasons ─────────────────────────────────────────────────

  "Admin data incomplete": {
    source: "HKFC Spec §2.2",
    text: "Active players missing any of Registered Team, Playing Position, or Playing Ability must be blocked from selection. These players should remain visible to coaches but clearly identified as requiring administrative correction.",
    isHkfcOverride: true,
  },

  Suspended: {
    source: "Bye-Law 16.3–16.10",
    text: "A player under suspension is not permitted to play in any match while the suspension is in effect. Suspensions are managed manually by administrators and may carry forward into future seasons where required by HKHA rulings.",
    isHkfcOverride: false,
  },

  "Visiting player — fixed to registered team": {
    source: "Bye-Law 6.1–6.2 & HKFC Spec §6.2",
    text: "Visiting Players (without HKID or Recognizance Form 8) may only play for their registered team. Any selection for another team is blocked.",
    isHkfcOverride: false,
  },

  "Visiting player — fewer than 5 appearances for registered team": {
    source: "Bye-Law 6.1–6.6 & HKFC Spec §6.3",
    text: "Visiting Players require five league appearances for their registered team before becoming eligible for any Cup, Plate or Bowl fixture.",
    isHkfcOverride: false,
  },

  "Available for [Team] on same day": {
    source: "Bye-Law 7.1 & HKFC Spec §7.2",
    text: "Players may not represent more than one team on the same calendar day. A lower-ranked team may not select a player who is available for a higher-ranked team fixture on the same day. Kick-off times are ignored — the restriction applies to the entire calendar day.",
    isHkfcOverride: false,
  },

  "Selected for [Team] on same day": {
    source: "Bye-Law 7.1 & HKFC Spec §7.2",
    text: "Players may not represent more than one team on the same calendar day. If a player has already been selected by a higher-ranked team, a lower-ranked team cannot select them.",
    isHkfcOverride: false,
  },

  "Higher-to-lower movement requires Committee approval": {
    source: "Bye-Law 7.2(a) & HKFC Spec §9.1",
    text: "Players may not move from a higher-ranked team to a lower-ranked team. This is a hard block and requires Committee approval to override.",
    isHkfcOverride: false,
  },

  "Premier movement restriction — team has not completed 3 matches": {
    source: "Bye-Law 7.4",
    text: "Movement between Premier Division and lower divisions is blocked until BOTH involved teams have completed at least three league matches. The rule applies regardless of movement direction.",
    isHkfcOverride: false,
  },

  "Play-up limit reached — re-registration required": {
    source: "Bye-Law 7.2 & HKFC Spec §13",
    text: "When a player records four qualifying play-up appearances above their registered team (excluding goalkeeper appearances), the player becomes unavailable for their registered team. The player's effective playing team becomes the lowest-ranked team for which they have accumulated four qualifying play-up appearances. This reflects HKFC's operational interpretation of automatic upward re-registration.",
    isHkfcOverride: true,
  },

  "Cup ban — ever registered to Premier Division": {
    source: "Bye-Law 7.7 & HKFC Spec §14.1",
    text: "Any player who has been registered to Premier Division at any point during the season is ineligible for Cup, Plate, and Bowl competitions.",
    isHkfcOverride: false,
  },

  "Fewer than 2 league appearances — ineligible for Cup": {
    source: "Bye-Law 7.10 & HKFC Spec §14.2",
    text: "A player must have at least two league appearances before participating in Cup competitions. The two league appearances requirement applies per team per season.",
    isHkfcOverride: false,
  },

  "Already played in a Cup for [Team] this season": {
    source: "Bye-Law 7.9 & HKFC Spec §14.3",
    text: "After appearing in any Cup competition (Cup, Plate, or Bowl) for a team, a player may not appear in Cup competitions for another team during the same season.",
    isHkfcOverride: false,
  },

  "U21 double-game limit reached": {
    source: "Bye-Law 7.6(c) & HKFC Spec §12.3",
    text: "Maximum of three U21 double-game players per team per day. A double-game player is a U21 player appearing in a second match on the same day. HKFC interpretation: U21 players may play for any higher-ranked team (not just the immediate next team), and match timing is not enforced.",
    isHkfcOverride: true,
  },

  // ── Warning reasons ──────────────────────────────────────────────────

  "Second play-up appearance": {
    source: "Bye-Law 7.2 & HKFC Spec §10",
    text: "A player recording their second play-up appearance this season. After four qualifying play-up appearances, the player must be re-registered to the higher team. Goalkeeper appearances (when playing as goalkeeper) do not count toward this total.",
    isHkfcOverride: false,
  },

  "Third play-up appearance": {
    source: "Bye-Law 7.2 & HKFC Spec §10",
    text: "A player recording their third play-up appearance this season. One more play-up appearance will trigger automatic re-registration. Goalkeeper appearances (when playing as goalkeeper) do not count toward this total.",
    isHkfcOverride: false,
  },

  "Visiting player early-season requirement at risk": {
    source: "Bye-Law 6.1–6.6 & HKFC Spec §6.4",
    text: "A Visiting Player who has appeared in consecutive early-season matches but remains below the 5-appearance threshold for Cup eligibility. Coaches should monitor to ensure the player reaches the required appearances before Cup fixtures begin.",
    isHkfcOverride: false,
  },

  "U21 double-game limit approaching": {
    source: "Bye-Law 7.6(c) & HKFC Spec §12.3",
    text: "The team is approaching the maximum of three U21 double-game players allowed per team per day (currently at 2 of 3). Adding another U21 double-game player will reach the limit.",
    isHkfcOverride: false,
  },
};

/**
 * Look up a reason tag by reason string prefix.
 * Handles dynamic reason strings like "Available for [Team] on same day"
 * or "Already played in a Cup for [Team] this season".
 */
function lookupReasonTag(reason: string): EligibilityReasonTag | null {
  // Exact match
  if (REASON_TAGS[reason]) return REASON_TAGS[reason];

  // Dynamic: "Available for X on same day"
  if (reason.match(/^Available for .+ on same day$/)) {
    return REASON_TAGS["Available for [Team] on same day"] ?? null;
  }

  // Dynamic: "Selected for X on same day"
  if (reason.match(/^Selected for .+ on same day$/)) {
    return REASON_TAGS["Selected for [Team] on same day"] ?? null;
  }

  // Dynamic: "Already played in a Cup for X this season"
  if (reason.match(/^Already played in a Cup for .+ this season$/)) {
    return REASON_TAGS["Already played in a Cup for [Team] this season"] ?? null;
  }

  return null;
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
      const pId = safeLinkId(mc.player);
      if (pId !== player.id) return false;
      if (mc.team !== player.registeredTeam) return false;
      if (mc.season !== currentSeason) return false;

      // If we can determine competitionType, only count league matches
      if (mc.match) {
        const mcMatch = mc.match as unknown as Match;
        if (mcMatch.competitionType || mcMatch.division) {
          return isLeague(mcMatch);
        }
      }
      // Best-effort: count when we can't determine competition type
      return true;
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
  allExceptions: Exception[],
): {
  blockReason: string | null;
  selectedByTeam: string | null;
  sameDayHigherTeam: string | null;
} {
  let selectedByTeam: string | null = null;
  let sameDayHigherTeam: string | null = null;

  for (const sdm of sameDayMatches) {
    const sdmTeam = hkfcTeamNameSafe(sdm, rankMap);
    if (!sdmTeam) continue;
    const sdmRank = rankMap[sdmTeam] ?? 99;

    // Cross-team selection visibility (independent of block)
    const sel = allSelections.find(
      (s) => safeLinkId(s.player) === player.id && safeLinkId(s.match) === sdm.id,
    );
    if (sel && sdmTeam !== targetHkfcTeam) {
      selectedByTeam = sdmTeam;
    }

    // Only consider HIGHER-ranked teams (lower numeric rank)
    if (sdmRank >= targetRank) continue;

    // If player is already selected by the higher team, block (even if unavailable)
    const higherSel = allSelections.find(
      (s) => safeLinkId(s.player) === player.id && safeLinkId(s.match) === sdm.id,
    );
    if (higherSel) {
      return {
        blockReason: `Selected for ${sdmTeam} on same day`,
        selectedByTeam: sdmTeam,
        sameDayHigherTeam: sdmTeam,
      };
    }

    // If player has an Unavailable exception, they're not "available" → skip
    const hasException = allExceptions.some(
      (e) =>
        e.playerId === player.id &&
        e.matchId === sdm.id &&
        e.status === "Unavailable",
    );
    if (hasException) {
      sameDayHigherTeam = sdmTeam;
      continue;
    }

    // Player is available for the higher team and not selected elsewhere → block
    return {
      blockReason: `Available for ${sdmTeam} on same day`,
      selectedByTeam,
      sameDayHigherTeam: sdmTeam,
    };
  }

  return { blockReason: null, selectedByTeam, sameDayHigherTeam };
}

// ── Step 5: Premier Division Restrictions (§8) ──────────────────────────

function checkPremierRestriction(
  player: Player,
  targetHkfcTeam: string,
  targetIsPremier: boolean,
  matchCards: MatchCard[],
  currentSeason: string,
  rankMap: RankMap,
): string | null {
  const { isPremier: playerIsPremier } = playerRanks(player, rankMap);

  // Only applies when crossing Premier ↔ non-Premier boundary
  if (targetIsPremier === playerIsPremier) return null;

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
  const matchIds = new Set<string>();
  for (const mc of matchCards) {
    if (mc.team === teamName && mc.season === season) {
      const mId = safeLinkId(mc.match);
      if (mId) matchIds.add(mId);
    }
  }
  return matchIds.size;
}

// ── Step 6: Play-Up Rules (§9-11, §13) ─────────────────────────────────

function checkPlayUpRules(
  player: Player,
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
    if (playUpCount >= 4) {
      return {
        blockReason: "Play-up limit reached — re-registration required",
        playUpCount,
      };
    }
  }

  return { blockReason: null, playUpCount };
}

function calculatePlayUpCount(
  player: Player,
  matchCards: MatchCard[],
  currentSeason: string,
): number {
  return matchCards.filter((mc) => {
    const pId = safeLinkId(mc.player);
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
  rankMap: RankMap,
): string | null {
  if (!isCup(match)) return null;

  // §14.1 — Premier Division Cup Ban
  if (player.everRegisteredToPremier === true) {
    return "Cup ban — ever registered to Premier Division";
  }

  // §14.2 — Minimum 2 league appearances
  const leagueApps = matchCards.filter((mc) => {
    const pId = safeLinkId(mc.player);
    return pId === player.id && mc.season === currentSeason;
  }).length;

  if (leagueApps < 2) {
    return "Fewer than 2 league appearances — ineligible for Cup";
  }

  // §14.3 — Cross-cup restriction
  const targetTeam = hkfcTeamNameSafe(match, rankMap) ?? "";
  const otherTeamCupCard = matchCards.find((mc) => {
    const pId = safeLinkId(mc.player);
    return pId === player.id && mc.team !== targetTeam && mc.season === currentSeason;
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
  allSelections: SquadSelection[],
  sameDayMatches: Match[],
  playersById: Map<string, Player>,
  rankMap: RankMap,
): string | null {
  if (!player.u21Eligible) return null;

  // Only applies when playing for a different (higher) team
  if (targetHkfcTeam === player.registeredTeam) return null;

  // Count U21 double-game players already selected for target team today
  let u21DoubleGameCount = 0;
  const countedIds = new Set<string>();

  for (const sel of allSelections) {
    const selMatchId = safeLinkId(sel.match);
    const selPlayerId = safeLinkId(sel.player);
    if (!selMatchId || !selPlayerId) continue;
    if (countedIds.has(selPlayerId)) continue;

    // Must be on the same day for the target team
    const selMatch = sameDayMatches.find((m) => m.id === selMatchId);
    if (!selMatch) continue;
    const selHkfcTeam = hkfcTeamNameSafe(selMatch, rankMap);
    if (selHkfcTeam !== targetHkfcTeam) continue;

    const selPlayer = playersById.get(selPlayerId);
    if (!selPlayer?.u21Eligible) continue;

    // Check if this U21 is also selected for their registered team same day
    const hasRegTeamSelection = allSelections.some((rs) => {
      const rpId = safeLinkId(rs.player);
      const rmId = safeLinkId(rs.match);
      if (rpId !== selPlayerId) return false;
      const rmMatch = sameDayMatches.find((m) => m.id === rmId);
      if (!rmMatch) return false;
      return hkfcTeamNameSafe(rmMatch, rankMap) === selPlayer!.registeredTeam;
    });

    if (hasRegTeamSelection) {
      u21DoubleGameCount++;
      countedIds.add(selPlayerId);
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
  playUpCount: number,
  matchCards: MatchCard[],
  currentSeason: string,
  targetHkfcTeam: string,
  u21DoubleGameCount: number,
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
      const pId = safeLinkId(mc.player);
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

  // U21 double-game limit approaching
  if (player.u21Eligible && targetHkfcTeam !== player.registeredTeam && u21DoubleGameCount >= 2) {
    warnings.push("U21 double-game limit approaching");
  }

  return warnings;
}

// ── U21 Double-Game Count Helper ────────────────────────────────────────

function countU21DoubleGames(
  targetHkfcTeam: string,
  allSelections: SquadSelection[],
  sameDayMatches: Match[],
  playersById: Map<string, Player>,
  rankMap: RankMap,
): number {
  let count = 0;
  const countedIds = new Set<string>();

  for (const sel of allSelections) {
    const selPlayerId = safeLinkId(sel.player);
    const selMatchId = safeLinkId(sel.match);
    if (!selPlayerId || !selMatchId) continue;
    if (countedIds.has(selPlayerId)) continue;

    const selMatch = sameDayMatches.find((m) => m.id === selMatchId);
    if (!selMatch) continue;
    const selTeam = hkfcTeamNameSafe(selMatch, rankMap);
    if (selTeam !== targetHkfcTeam) continue;

    const selPlayer = playersById.get(selPlayerId);
    if (!selPlayer?.u21Eligible) continue;

    const hasRegSel = allSelections.some((rs) => {
      const rp = safeLinkId(rs.player);
      const rm = safeLinkId(rs.match);
      if (rp !== selPlayerId) return false;
      const rmMatch = sameDayMatches.find((m) => m.id === rm);
      return rmMatch
        ? hkfcTeamNameSafe(rmMatch, rankMap) === selPlayer!.registeredTeam
        : false;
    });

    if (hasRegSel) {
      count++;
      countedIds.add(selPlayerId);
    }
  }

  return count;
}

// ── Result helpers ──────────────────────────────────────────────────────

function blockedResult(reason: string, extras?: Partial<EligibilityResult>): EligibilityResult {
  return {
    status: "blocked",
    reason,
    reasonTag: lookupReasonTag(reason),
    warnings: [],
    warningTags: [],
    playUpCount: extras?.playUpCount ?? 0,
    selectedByTeam: extras?.selectedByTeam ?? null,
    sameDayHigherTeam: extras?.sameDayHigherTeam ?? null,
  };
}

function nonBlockedResult(
  status: "eligible" | "warning",
  warnings: string[],
  playUpCount: number,
  selectedByTeam: string | null,
  sameDayHigherTeam: string | null,
): EligibilityResult {
  return {
    status,
    reason: null,
    reasonTag: null,
    warnings,
    warningTags: warnings.map((w) => lookupReasonTag(w)).filter(Boolean) as EligibilityReasonTag[],
    playUpCount,
    selectedByTeam,
    sameDayHigherTeam,
  };
}

// ── Main evaluation entry point ─────────────────────────────────────────

export interface EvaluationContext {
  teamMap: TeamMap;
  /** Computed once from teamMap; passed to all helpers. */
  rankMap: RankMap;
  sameDayMatches: Match[];
  allSelections: SquadSelection[];
  allExceptions: Exception[];
  matchCards: MatchCard[];
  currentSeason: string;
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
  const rankMap = buildRankMap(ctx.teamMap);
  // Use ctx.rankMap if provided, otherwise fall back to freshly built one
  const effectiveRankMap = Object.keys(ctx.rankMap).length > 0 ? ctx.rankMap : rankMap;

  const targetHkfcTeam = hkfcTeamNameSafe(match, effectiveRankMap);
  if (!targetHkfcTeam || effectiveRankMap[targetHkfcTeam] === undefined) {
    return blockedResult("Admin data incomplete");
  }

  const { rank: targetRank, isPremier: targetIsPremier } = teamRanks(
    targetHkfcTeam, effectiveRankMap, ctx.teamMap,
  );
  const { playerRank } = playerRanks(player, effectiveRankMap);

  // ── Step 1: Admin Data Validation ──
  const adminBlock = checkAdminData(player);
  if (adminBlock) return blockedResult(adminBlock);

  // ── Step 2: Suspension ──
  const suspensionBlock = checkSuspension(player);
  if (suspensionBlock) return blockedResult(suspensionBlock);

  // ── Step 3: Visiting Player ──
  const visitingBlock = checkVisitingPlayer(
    player, targetHkfcTeam, match, ctx.matchCards, ctx.currentSeason,
  );
  if (visitingBlock) return blockedResult(visitingBlock);

  // ── Step 4: Same-Day Movement ──
  const sameDayResult = checkSameDayMovement(
    player, targetHkfcTeam, targetRank, match, effectiveRankMap,
    ctx.sameDayMatches, ctx.allSelections, ctx.allExceptions,
  );
  if (sameDayResult.blockReason) {
    return blockedResult(sameDayResult.blockReason, {
      selectedByTeam: sameDayResult.selectedByTeam,
      sameDayHigherTeam: sameDayResult.sameDayHigherTeam,
    });
  }

  // ── Step 5: Premier Division Restriction ──
  const premierBlock = checkPremierRestriction(
    player, targetHkfcTeam, targetIsPremier,
    ctx.matchCards, ctx.currentSeason, effectiveRankMap,
  );
  if (premierBlock) {
    return blockedResult(premierBlock, {
      selectedByTeam: sameDayResult.selectedByTeam,
      sameDayHigherTeam: sameDayResult.sameDayHigherTeam,
    });
  }

  // ── Step 6: Play-Up Rules ──
  const playUpResult = checkPlayUpRules(
    player, targetRank, playerRank,
    ctx.matchCards, ctx.currentSeason,
  );
  if (playUpResult.blockReason) {
    return blockedResult(playUpResult.blockReason, {
      playUpCount: playUpResult.playUpCount,
      selectedByTeam: sameDayResult.selectedByTeam,
      sameDayHigherTeam: sameDayResult.sameDayHigherTeam,
    });
  }

  // ── Step 7: Cup Eligibility ──
  const cupBlock = checkCupEligibility(
    player, match, ctx.matchCards, ctx.currentSeason, effectiveRankMap,
  );
  if (cupBlock) {
    return blockedResult(cupBlock, {
      playUpCount: playUpResult.playUpCount,
      selectedByTeam: sameDayResult.selectedByTeam,
      sameDayHigherTeam: sameDayResult.sameDayHigherTeam,
    });
  }

  // ── Step 8: U21 Double-Game ──
  const u21Block = checkU21DoubleGame(
    player, targetHkfcTeam,
    ctx.allSelections, ctx.sameDayMatches, ctx.playersById, effectiveRankMap,
  );
  if (u21Block) {
    return blockedResult(u21Block, {
      playUpCount: playUpResult.playUpCount,
      selectedByTeam: sameDayResult.selectedByTeam,
      sameDayHigherTeam: sameDayResult.sameDayHigherTeam,
    });
  }

  // ── Count U21 double-games for warning threshold ──
  const u21DoubleGameCount = countU21DoubleGames(
    targetHkfcTeam, ctx.allSelections, ctx.sameDayMatches, ctx.playersById, effectiveRankMap,
  );

  // ── Generate Warnings ──
  const warnings = generateWarnings(
    player, playUpResult.playUpCount, ctx.matchCards, ctx.currentSeason,
    targetHkfcTeam, u21DoubleGameCount,
  );

  return nonBlockedResult(
    warnings.length > 0 ? "warning" : "eligible",
    warnings,
    playUpResult.playUpCount,
    sameDayResult.selectedByTeam,
    sameDayResult.sameDayHigherTeam,
  );
}
