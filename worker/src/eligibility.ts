import { linkId } from "./airtable";
import type { Match, MatchCard, Player, Team } from "../../src/generated/domainTypes";

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

export interface VirtualSelection {
  player: string[];
  match: string[];
  /** The selected HKFC side. Present for derby-safe selections. */
  team?: string;
}

// ── Internal helpers ────────────────────────────────────────────────────

type TeamMap = Map<string, Team>;
type RankMap = Record<string, number>;
type Exception = { playerId: string; matchId: string; status: string };
type SameDayTeamFixture = { matchId: string; teamName: string };

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

function selectionKey(matchId: string, teamName: string): string {
  return `${matchId}:${teamName}`;
}

function cardsForPlayer(playerId: string, ctx: EvaluationContext): MatchCard[] {
  return ctx.matchCardsByPlayer?.get(playerId) ?? ctx.matchCards.filter((card) => safeLinkId(card.player) === playerId);
}

function matchForCard(card: MatchCard, ctx: EvaluationContext): Match | undefined {
  const matchId = safeLinkId(card.match);
  return matchId ? ctx.matchesById?.get(matchId) : undefined;
}

function isLeague(match: Match | undefined | null): boolean {
  if (!match) return false;
  return (
    (match.competitionType || match.division || "")
      .toLowerCase()
      .includes("league") ||
    (!match.competitionType && !isCup(match))
  );
}

function isCup(match: Match | undefined | null): boolean {
  if (!match) return false;
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
  ctx: EvaluationContext,
): string | null {
  if (!player.isVisitingPlayer) return null;

  if (player.registeredTeam !== targetHkfcTeam) {
    return "Visiting player — fixed to registered team";
  }

  if (isCup(match)) {
    const appearances = cardsForPlayer(player.id, ctx).filter(
      (card) => card.season === ctx.currentSeason
    ).length;
    if (appearances < 5) {
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
  rankMap: RankMap,
  sameDayMatches: Match[],
  allSelections: VirtualSelection[],
  allExceptions: Exception[],
  ctx?: EvaluationContext,
): {
  blockReason: string | null;
  selectedByTeam: string | null;
  sameDayHigherTeam: string | null;
} {
  let selectedByTeam: string | null = null;
  let sameDayHigherTeam: string | null = null;
  const sameDayFixtures = ctx?.sameDayFixtures ?? sameDayMatches.map((sdm) => ({
    matchId: sdm.id,
    teamName: hkfcTeamNameSafe(sdm, rankMap) ?? "",
  }));
  const playerSelections = ctx?.selectionsByPlayer?.get(player.id);

  for (const fixture of sameDayFixtures) {
    const sdmTeam = fixture.teamName;
    if (!sdmTeam) continue;
    const sdmRank = rankMap[sdmTeam] ?? 99;
    const isSelected = playerSelections
      ? playerSelections.has(selectionKey(fixture.matchId, sdmTeam))
      : allSelections.some((selection) => safeLinkId(selection.player) === player.id && safeLinkId(selection.match) === fixture.matchId && (!selection.team || selection.team === sdmTeam));

    // Cross-team selection visibility (independent of block)
    if (isSelected && sdmTeam !== targetHkfcTeam) {
      selectedByTeam = sdmTeam;
    }

    // Only U21 players moving from their registered team to a higher-ranked
    // team may be selected twice on the same date.
    const permittedU21DoubleGame = player.u21Eligible &&
      sdmTeam === player.registeredTeam &&
      targetRank < (rankMap[player.registeredTeam || ""] ?? 99);
    if (isSelected && sdmTeam !== targetHkfcTeam && !permittedU21DoubleGame) {
      return {
        blockReason: `Selected for ${sdmTeam} on same day`,
        selectedByTeam: sdmTeam,
        sameDayHigherTeam: sdmRank < targetRank ? sdmTeam : null,
      };
    }

    // Only consider HIGHER-ranked teams (lower numeric rank)
    if (sdmRank >= targetRank) continue;

    // If player is already selected by the higher team, block (even if unavailable)
    if (isSelected) {
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
        e.matchId === fixture.matchId &&
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
  ctx: EvaluationContext,
  rankMap: RankMap,
): string | null {
  const { isPremier: playerIsPremier } = playerRanks(player, rankMap);

  // Only applies when crossing Premier ↔ non-Premier boundary
  if (targetIsPremier === playerIsPremier) return null;

  // Count completed league matches for each team
  const targetCompleted = countCompletedMatches(targetHkfcTeam, ctx);
  const playerCompleted = countCompletedMatches(
    player.registeredTeam || "",
    ctx,
  );

  if (targetCompleted < 3 || playerCompleted < 3) {
    return "Premier movement restriction — team has not completed 3 matches";
  }

  return null;
}

function countCompletedMatches(teamName: string, ctx: EvaluationContext): number {
  const matchIds = new Set<string>();
  for (const mc of ctx.matchCards) {
    if (mc.team === teamName && isLeague(matchForCard(mc, ctx))) {
      const mId = safeLinkId(mc.match);
      if (mId) matchIds.add(mId);
    }
  }
  return matchIds.size;
}

function indexedU21DoubleGameCount(targetHkfcTeam: string, ctx: EvaluationContext): number | null {
  const selectedForTarget = ctx.sameDaySelectionsByTeam?.get(targetHkfcTeam);
  if (!selectedForTarget) return null;
  let count = 0;
  for (const playerId of selectedForTarget) {
    const selectedPlayer = ctx.playersById.get(playerId);
    if (!selectedPlayer?.u21Eligible || !selectedPlayer.registeredTeam || selectedPlayer.registeredTeam === targetHkfcTeam) continue;
    if (ctx.sameDaySelectionsByTeam?.get(selectedPlayer.registeredTeam)?.has(playerId)) count++;
  }
  return count;
}

// ── Step 6: Play-Up Rules (§9-11, §13) ─────────────────────────────────

function checkPlayUpRules(
  player: Player,
  targetRank: number,
  playerRank: number,
  ctx: EvaluationContext,
): { blockReason: string | null; playUpCount: number } {
  const playUpCount = calculatePlayUpCount(player, ctx);

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
  ctx: EvaluationContext,
): number {
  return cardsForPlayer(player.id, ctx).filter((mc) => {
    if (!mc.playUp) return false;
    // §11.2 — GK exemption: exclude GK appearances from count
    if (mc.goalkeeper) return false;
    return true;
  }).length;
}

// ── Step 7: Cup Eligibility (§14) ──────────────────────────────────────

function checkCupEligibility(
  player: Player,
  match: Match,
  targetTeam: string,
  ctx: EvaluationContext,
): string | null {
  if (!isCup(match)) return null;

  // §14.1 — Premier Division Cup Ban
  if (player.everRegisteredToPremier === true) {
    return "Cup ban — ever registered to Premier Division";
  }

  // §14.2 — Minimum 2 league appearances
  const cards = cardsForPlayer(player.id, ctx);
  const leagueApps = cards.filter((card) => isLeague(matchForCard(card, ctx))).length;

  if (leagueApps < 2) {
    return "Fewer than 2 league appearances — ineligible for Cup";
  }

  // §14.3 — Cross-cup restriction
  const otherTeamCupCard = cards.find((card) =>
    card.team !== targetTeam && isCup(matchForCard(card, ctx)),
  );

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
  allSelections: VirtualSelection[],
  sameDayMatches: Match[],
  playersById: Map<string, Player>,
  rankMap: RankMap,
  ctx?: EvaluationContext,
): string | null {
  if (!player.u21Eligible) return null;

  // Only applies when playing for a different (higher) team
  if (targetHkfcTeam === player.registeredTeam) return null;

  const indexedCount = ctx ? indexedU21DoubleGameCount(targetHkfcTeam, ctx) : null;
  if (indexedCount !== null && ctx) {
    const alreadySelected = ctx.sameDaySelectionsByTeam?.get(targetHkfcTeam)?.has(player.id) ?? false;
    return indexedCount >= 3 && !alreadySelected ? "U21 double-game limit reached" : null;
  }

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
  allSelections: VirtualSelection[],
  sameDayMatches: Match[],
  playersById: Map<string, Player>,
  rankMap: RankMap,
  ctx?: EvaluationContext,
): number {
  const indexedCount = ctx ? indexedU21DoubleGameCount(targetHkfcTeam, ctx) : null;
  if (indexedCount !== null) return indexedCount;
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
  /** Explicitly selected side of the match; required for HKFC derby fixtures. */
  targetTeam?: string;
  sameDayMatches: Match[];
  /** One entry per HKFC team on the day, so both derby teams are represented. */
  sameDayFixtures?: SameDayTeamFixture[];
  allSelections: VirtualSelection[];
  /** O(1) selection lookup, keyed by player then match/team. */
  selectionsByPlayer?: Map<string, Set<string>>;
  /** O(1) same-day selected-player lookup, keyed by team. */
  sameDaySelectionsByTeam?: Map<string, Set<string>>;
  allExceptions: Exception[];
  /** O(1) lookup for Unavailable exceptions, keyed by player/match. */
  unavailablePlayerMatchKeys?: Set<string>;
  matchCards: MatchCard[];
  /** Current-season match cards grouped by player. */
  matchCardsByPlayer?: Map<string, MatchCard[]>;
  /** Matches keyed by record id, used to distinguish league and cup cards. */
  matchesById?: Map<string, Match>;
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
  const effectiveRankMap = ctx.rankMap;

  const targetHkfcTeam = ctx.targetTeam ?? hkfcTeamNameSafe(match, effectiveRankMap);
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
    player, targetHkfcTeam, match, ctx,
  );
  if (visitingBlock) return blockedResult(visitingBlock);

  // ── Step 4: Same-Day Movement ──
  const sameDayResult = checkSameDayMovement(
    player, targetHkfcTeam, targetRank, effectiveRankMap,
    ctx.sameDayMatches, ctx.allSelections, ctx.allExceptions, ctx,
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
    ctx, effectiveRankMap,
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
    ctx,
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
    player, match, targetHkfcTeam, ctx,
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
    ctx.allSelections, ctx.sameDayMatches, ctx.playersById, effectiveRankMap, ctx,
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
    targetHkfcTeam, ctx.allSelections, ctx.sameDayMatches, ctx.playersById, effectiveRankMap, ctx,
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
