import { linkId } from "./airtable";
import { recordEligibilityEvaluation } from "./metrics";
import type { Match, MatchCard, Player, Team } from "../../src/generated/domainTypes";

// ── Public types ────────────────────────────────────────────────────────

/** Stable internal identifiers for every rule. UI never displays these;
 *  reason strings remain the single coach-facing source of truth. */
export const RULE_IDS = {
  ADMIN_DATA_INCOMPLETE: "ADMIN_DATA_INCOMPLETE",
  SUSPENSION: "SUSPENSION",
  VISITING_FIXED_TEAM: "VISITING_FIXED_TEAM",
  VISITING_CUP_APPEARANCES: "VISITING_CUP_APPEARANCES",
  SAME_DAY_AVAILABLE: "SAME_DAY_AVAILABLE",
  SAME_DAY_SELECTED: "SAME_DAY_SELECTED",
  HIGHER_TO_LOWER: "HIGHER_TO_LOWER",
  PREMIER_MOVEMENT: "PREMIER_MOVEMENT",
  PLAYUP_LIMIT: "PLAYUP_LIMIT",
  CUP_BAN_PREMIER: "CUP_BAN_PREMIER",
  CUP_MIN_LEAGUE_APPEARANCES: "CUP_MIN_LEAGUE_APPEARANCES",
  CROSS_CUP: "CROSS_CUP",
  U21_DOUBLE_GAME_LIMIT: "U21_DOUBLE_GAME_LIMIT",
  WARN_PLAYUP_SECOND: "WARN_PLAYUP_SECOND",
  WARN_PLAYUP_THIRD: "WARN_PLAYUP_THIRD",
  WARN_VISITING_EARLY_SEASON: "WARN_VISITING_EARLY_SEASON",
  WARN_U21_APPROACHING: "WARN_U21_APPROACHING",
} as const;

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
  /** Stable internal identifier (UI never displays this). */
  ruleId: string;
}

export interface EligibilityResult {
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
  /** Stable internal ID of the blocking rule; null when not blocked. */
  ruleId: string | null;
  /** Optional step-by-step evaluation trace (debug mode only; never shown to coaches). */
  trace?: string[];
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
  return ctx.matchCardsByPlayer.get(playerId) ?? [];
}

function matchForCard(card: MatchCard, ctx: EvaluationContext): Match | undefined {
  const matchId = safeLinkId(card.match);
  return matchId ? ctx.matchesById.get(matchId) : undefined;
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
  return ct === "knockout" || ct.includes("cup") || ct.includes("plate") || ct.includes("bowl");
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
 * Reason strings are byte-identical to Spec §16 — never reword them.
 */
const REASON_TAGS: Record<string, EligibilityReasonTag> = {
  // ── Blocked reasons ─────────────────────────────────────────────────
  "Admin data incomplete": {
    ruleId: RULE_IDS.ADMIN_DATA_INCOMPLETE,
    source: "HKFC Spec §2.2",
    text: "Active players missing any of Registered Team, Playing Position, or Playing Ability must be blocked from selection. These players should remain visible to coaches but clearly identified as requiring administrative correction.",
    isHkfcOverride: true,
  },
  Suspended: {
    ruleId: RULE_IDS.SUSPENSION,
    source: "Bye-Law 16.3–16.10",
    text: "A player under suspension is not permitted to play in any match while the suspension is in effect. Suspensions are managed manually by administrators and may carry forward into future seasons where required by HKHA rulings.",
    isHkfcOverride: false,
  },
  "Visiting player — fixed to registered team": {
    ruleId: RULE_IDS.VISITING_FIXED_TEAM,
    source: "Bye-Law 6.1–6.2 & HKFC Spec §6.2",
    text: "Visiting Players (without HKID or Recognizance Form 8) may only play for their registered team. Any selection for another team is blocked.",
    isHkfcOverride: false,
  },
  "Visiting player — fewer than 5 appearances for registered team": {
    ruleId: RULE_IDS.VISITING_CUP_APPEARANCES,
    source: "Bye-Law 6.1–6.6 & HKFC Spec §6.3",
    text: "Visiting Players require five league appearances for their registered team before becoming eligible for any Cup, Plate or Bowl fixture.",
    isHkfcOverride: false,
  },
  "Available for [Team] on same day": {
    ruleId: RULE_IDS.SAME_DAY_AVAILABLE,
    source: "Bye-Law 7.1 & HKFC Spec §7.2",
    text: "Players may not represent more than one team on the same calendar day. A lower-ranked team may not select a player who is available for a higher-ranked team fixture on the same day. Kick-off times are ignored — the restriction applies to the entire calendar day.",
    isHkfcOverride: false,
  },
  "Selected for [Team] on same day": {
    ruleId: RULE_IDS.SAME_DAY_SELECTED,
    source: "Bye-Law 7.1 & HKFC Spec §7.2",
    text: "Players may not represent more than one team on the same calendar day. If a player has already been selected by a higher-ranked team, a lower-ranked team cannot select them.",
    isHkfcOverride: false,
  },
  "Higher-to-lower movement requires Committee approval": {
    ruleId: RULE_IDS.HIGHER_TO_LOWER,
    source: "Bye-Law 7.2(a) & HKFC Spec §9.1",
    text: "Players may not move from a higher-ranked team to a lower-ranked team. This is a hard block and requires Committee approval to override.",
    isHkfcOverride: false,
  },
  "Premier movement restriction — team has not completed 3 matches": {
    ruleId: RULE_IDS.PREMIER_MOVEMENT,
    source: "Bye-Law 7.4",
    text: "Movement between Premier Division and lower divisions is blocked until BOTH involved teams have completed at least three league matches. The rule applies regardless of movement direction.",
    isHkfcOverride: false,
  },
  "Play-up limit reached — re-registration required": {
    ruleId: RULE_IDS.PLAYUP_LIMIT,
    source: "Bye-Law 7.2 & HKFC Spec §13",
    text: "When a player records four qualifying play-up appearances above their registered team (excluding goalkeeper appearances), the player becomes unavailable for their registered team. The player's effective playing team becomes the lowest-ranked team for which they have accumulated four qualifying play-up appearances. This reflects HKFC's operational interpretation of automatic upward re-registration.",
    isHkfcOverride: true,
  },
  "Cup ban — ever registered to Premier Division": {
    ruleId: RULE_IDS.CUP_BAN_PREMIER,
    source: "Bye-Law 7.7 & HKFC Spec §14.1",
    text: "Any player who has been registered to Premier Division at any point during the season is ineligible for Cup, Plate, and Bowl competitions.",
    isHkfcOverride: false,
  },
  "Fewer than 2 league appearances — ineligible for Cup": {
    ruleId: RULE_IDS.CUP_MIN_LEAGUE_APPEARANCES,
    source: "Bye-Law 7.10 & HKFC Spec §14.2",
    text: "A player must have at least two league appearances before participating in Cup competitions. The two league appearances requirement applies per team per season.",
    isHkfcOverride: false,
  },
  "Already played in a Cup for [Team] this season": {
    ruleId: RULE_IDS.CROSS_CUP,
    source: "Bye-Law 7.9 & HKFC Spec §14.3",
    text: "After appearing in any Cup competition (Cup, Plate, or Bowl) for a team, a player may not appear in Cup competitions for another team during the same season.",
    isHkfcOverride: false,
  },
  "U21 double-game limit reached": {
    ruleId: RULE_IDS.U21_DOUBLE_GAME_LIMIT,
    source: "Bye-Law 7.6(c) & HKFC Spec §12.3",
    text: "Maximum of three U21 double-game players per team per day. A double-game player is a U21 player appearing in a second match on the same day. HKFC interpretation: U21 players may play for any higher-ranked team (not just the immediate next team), and match timing is not enforced.",
    isHkfcOverride: true,
  },
  // ── Warning reasons ──────────────────────────────────────────────────
  "Second play-up appearance": {
    ruleId: RULE_IDS.WARN_PLAYUP_SECOND,
    source: "Bye-Law 7.2 & HKFC Spec §10",
    text: "A player recording their second play-up appearance this season. After four qualifying play-up appearances, the player must be re-registered to the higher team. Goalkeeper appearances (when playing as goalkeeper) do not count toward this total.",
    isHkfcOverride: false,
  },
  "Third play-up appearance": {
    ruleId: RULE_IDS.WARN_PLAYUP_THIRD,
    source: "Bye-Law 7.2 & HKFC Spec §10",
    text: "A player recording their third play-up appearance this season. One more play-up appearance will trigger automatic re-registration. Goalkeeper appearances (when playing as goalkeeper) do not count toward this total.",
    isHkfcOverride: false,
  },
  "Visiting player early-season requirement at risk": {
    ruleId: RULE_IDS.WARN_VISITING_EARLY_SEASON,
    source: "Bye-Law 6.1–6.6 & HKFC Spec §6.4",
    text: "A Visiting Player who has appeared in consecutive early-season matches but remains below the 5-appearance threshold for Cup eligibility. Coaches should monitor to ensure the player reaches the required appearances before Cup fixtures begin.",
    isHkfcOverride: false,
  },
  "U21 double-game limit approaching": {
    ruleId: RULE_IDS.WARN_U21_APPROACHING,
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
export function lookupReasonTag(reason: string): EligibilityReasonTag | null {
  if (REASON_TAGS[reason]) return REASON_TAGS[reason];
  if (reason.match(/^Available for .+ on same day$/)) {
    return REASON_TAGS["Available for [Team] on same day"] ?? null;
  }
  if (reason.match(/^Selected for .+ on same day$/)) {
    return REASON_TAGS["Selected for [Team] on same day"] ?? null;
  }
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
    // Spec §6.3: five appearances FOR THE REGISTERED TEAM.
    const appearances = cardsForPlayer(player.id, ctx).filter(
      (card) =>
        card.season === ctx.currentSeason &&
        card.team === player.registeredTeam,
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
  ctx: EvaluationContext,
): {
  blockReason: string | null;
  selectedByTeam: string | null;
  sameDayHigherTeam: string | null;
  warnings: string[];
} {
  let selectedByTeam: string | null = null;
  let sameDayHigherTeam: string | null = null;
  const warnings: string[] = [];
  const playerSelections = ctx.selectionsByPlayer.get(player.id);
  const playerRank = playerRanks(player, rankMap).playerRank;

  for (const fixture of ctx.sameDayFixtures) {
    const sdmTeam = fixture.teamName;
    if (!sdmTeam) continue;
    const sdmRank = rankMap[sdmTeam] ?? 99;
    const isSelected =
      playerSelections?.has(selectionKey(fixture.matchId, sdmTeam)) ?? false;

    // Cross-team selection visibility — independent of any block (§2 MVP req).
    if (isSelected && sdmTeam !== targetHkfcTeam) {
      selectedByTeam = sdmTeam;
    }

    // Only higher-ranked fixtures trigger the same-day lock (§7.2).
    if (sdmRank >= targetRank) continue;
    // Only enforce when the other team sits above the player's registered team.
    if (playerRank <= sdmRank) continue;

    sameDayHigherTeam = sdmTeam;

    if (isSelected) {
      return {
        blockReason: `Selected for ${sdmTeam} on same day`,
        selectedByTeam: sdmTeam,
        sameDayHigherTeam: sdmTeam,
        warnings,
      };
    }
    // Availability lock: no Unavailable exception = available (§7.2).
    const hasException = ctx.unavailablePlayerMatchKeys.has(
      `${player.id}:${fixture.matchId}`,
    );
    if (!hasException) {
      return {
        blockReason: `Available for ${sdmTeam} on same day`,
        selectedByTeam,
        sameDayHigherTeam: sdmTeam,
        warnings,
      };
    }
    // Unavailable exception for the higher fixture releases the lock.
  }

  return { blockReason: null, selectedByTeam, sameDayHigherTeam, warnings };
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
  return ctx.completedLeagueMatchesByTeam.get(teamName) ?? 0;
}

export function computeCompletedLeagueMatchCounts(
  ctx: Pick<EvaluationContext, "matchCards" | "matchesById">,
): Map<string, number> {
  const matchIdsByTeam = new Map<string, Set<string>>();
  for (const card of ctx.matchCards) {
    if (!card.team) continue;
    const cardMatchId = safeLinkId(card.match);
    if (!cardMatchId) continue;
    const cardMatch = ctx.matchesById.get(cardMatchId);
    if (!isLeague(cardMatch)) continue;
    const set = matchIdsByTeam.get(card.team) ?? new Set<string>();
    set.add(cardMatchId);
    matchIdsByTeam.set(card.team, set);
  }
  const counts = new Map<string, number>();
  for (const [team, set] of matchIdsByTeam) counts.set(team, set.size);
  return counts;
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
    if (mc.goalkeeper) return false; // GK exemption (§11)
    if (mc.season && mc.season !== ctx.currentSeason) return false;
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
  ctx: EvaluationContext,
): string | null {
  if (!player.u21Eligible) return null;
  if (targetHkfcTeam === player.registeredTeam) return null;
  const count = indexedU21DoubleGameCount(targetHkfcTeam, ctx);
  if (count === null) return null;
  const alreadySelected = ctx.sameDaySelectionsByTeam.get(targetHkfcTeam)?.has(player.id) ?? false;
  return count >= 3 && !alreadySelected ? "U21 double-game limit reached" : null;
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
  if (playUpCount === 2) {
    warnings.push("Second play-up appearance");
  } else if (playUpCount === 3) {
    warnings.push("Third play-up appearance");
  }
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
  if (player.u21Eligible && targetHkfcTeam !== player.registeredTeam && u21DoubleGameCount >= 2) {
    warnings.push("U21 double-game limit approaching");
  }
  return warnings;
}

// ── Result helpers ──────────────────────────────────────────────────────
function blockedResult(reason: string, extras?: Partial<EligibilityResult>): EligibilityResult {
  const tag = lookupReasonTag(reason);
  return {
    status: "blocked",
    reason,
    reasonTag: tag,
    ruleId: tag?.ruleId ?? null,
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
    ruleId: null,
    warnings,
    warningTags: warnings.map((w) => lookupReasonTag(w)).filter(Boolean) as EligibilityReasonTag[],
    playUpCount,
    selectedByTeam,
    sameDayHigherTeam,
  };
}

// ── Evaluation context ──────────────────────────────────────────────────
export interface EvaluationContext {
  teamMap: TeamMap;
  rankMap: RankMap;
  targetTeam?: string;
  sameDayMatches: Match[];
  sameDayFixtures: SameDayTeamFixture[];
  allSelections: VirtualSelection[];
  selectionsByPlayer: Map<string, Set<string>>;
  sameDaySelectionsByTeam: Map<string, Set<string>>;
  allExceptions: Exception[];
  unavailablePlayerMatchKeys: Set<string>;
  matchCards: MatchCard[];
  matchCardsByPlayer: Map<string, MatchCard[]>;
  matchesById: Map<string, Match>;
  currentSeason: string;
  playersById: Map<string, Player>;
  completedLeagueMatchesByTeam: Map<string, number>;
}

// ── Internal evaluation (trace-aware) ───────────────────────────────────
function evaluateInternal(
  player: Player,
  match: Match,
  ctx: EvaluationContext,
  opts?: { trace?: boolean },
): EligibilityResult {
  const trace: string[] | null = opts?.trace ? [] : null;
  const t = (line: string) => { if (trace) trace.push(line); };
  const finish = (r: EligibilityResult): EligibilityResult => {
    if (trace) r.trace = trace;
    return r;
  };

  const effectiveRankMap = ctx.rankMap;
  const targetHkfcTeam = ctx.targetTeam ?? hkfcTeamNameSafe(match, effectiveRankMap);
  if (!targetHkfcTeam || effectiveRankMap[targetHkfcTeam] === undefined) {
    t("✗ Step 0 — Target team unresolvable → Admin data incomplete");
    return finish(blockedResult("Admin data incomplete"));
  }
  const { rank: targetRank, isPremier: targetIsPremier } = teamRanks(
    targetHkfcTeam, effectiveRankMap, ctx.teamMap,
  );
  const { playerRank } = playerRanks(player, effectiveRankMap);

  // ── Step 1: Admin Data Validation ──
  const adminBlock = checkAdminData(player);
  if (adminBlock) {
    t(`✗ Step 1 — ${adminBlock}`);
    return finish(blockedResult(adminBlock));
  }
  t("✓ Step 1 — Admin data complete");

  // ── Step 2: Suspension ──
  const suspensionBlock = checkSuspension(player);
  if (suspensionBlock) {
    t(`✗ Step 2 — ${suspensionBlock}`);
    return finish(blockedResult(suspensionBlock));
  }
  t("✓ Step 2 — Suspension clear");

  // ── Step 3: Visiting Player ──
  const visitingBlock = checkVisitingPlayer(player, targetHkfcTeam, match, ctx);
  if (visitingBlock) {
    t(`✗ Step 3 — ${visitingBlock}`);
    return finish(blockedResult(visitingBlock));
  }
  t("✓ Step 3 — Visiting player clear");

  // ── Step 4: Same-Day Movement ──
  const sameDayResult = checkSameDayMovement(
    player, targetHkfcTeam, targetRank, effectiveRankMap, ctx,
  );
  if (sameDayResult.blockReason) {
    t(`✗ Step 4 — ${sameDayResult.blockReason}`);
    return finish(blockedResult(sameDayResult.blockReason, {
      selectedByTeam: sameDayResult.selectedByTeam,
      sameDayHigherTeam: sameDayResult.sameDayHigherTeam,
    }));
  }
  t("✓ Step 4 — Same-day movement clear");
  const sameDayWarnings = sameDayResult.warnings;

  // ── Step 5: Premier Division Restriction (evaluated before play-up rules,
  //    regardless of movement direction — Spec §4 / §8) ──
  const premierBlock = checkPremierRestriction(
    player, targetHkfcTeam, targetIsPremier, ctx, effectiveRankMap,
  );
  if (premierBlock) {
    t(`✗ Step 5 — ${premierBlock}`);
    return finish(blockedResult(premierBlock, {
      selectedByTeam: sameDayResult.selectedByTeam,
      sameDayHigherTeam: sameDayResult.sameDayHigherTeam,
    }));
  }
  t("✓ Step 5 — Premier restriction clear");

  // ── Step 6: Play-Up Rules ──
  const playUpResult = checkPlayUpRules(player, targetRank, playerRank, ctx);
  if (playUpResult.blockReason) {
    t(`✗ Step 6 — ${playUpResult.blockReason}`);
    return finish(blockedResult(playUpResult.blockReason, {
      playUpCount: playUpResult.playUpCount,
      selectedByTeam: sameDayResult.selectedByTeam,
      sameDayHigherTeam: sameDayResult.sameDayHigherTeam,
    }));
  }
  t(`✓ Step 6 — Play-up clear (count ${playUpResult.playUpCount})`);

  // ── Step 7: Cup Eligibility ──
  const cupBlock = checkCupEligibility(player, match, targetHkfcTeam, ctx);
  if (cupBlock) {
    t(`✗ Step 7 — ${cupBlock}`);
    return finish(blockedResult(cupBlock, {
      playUpCount: playUpResult.playUpCount,
      selectedByTeam: sameDayResult.selectedByTeam,
      sameDayHigherTeam: sameDayResult.sameDayHigherTeam,
    }));
  }
  t("✓ Step 7 — Cup eligibility clear");

  // ── Step 8: U21 Double-Game ──
  const u21Block = checkU21DoubleGame(player, targetHkfcTeam, ctx);
  if (u21Block) {
    t(`✗ Step 8 — ${u21Block}`);
    return finish(blockedResult(u21Block, {
      playUpCount: playUpResult.playUpCount,
      selectedByTeam: sameDayResult.selectedByTeam,
      sameDayHigherTeam: sameDayResult.sameDayHigherTeam,
    }));
  }
  t("✓ Step 8 — U21 double-game clear");

  // ── Count U21 double-games for warning threshold ──
  const u21DoubleGameCount = indexedU21DoubleGameCount(targetHkfcTeam, ctx) ?? 0;

  // ── Generate Warnings ──
  const warnings = generateWarnings(
    player, playUpResult.playUpCount, ctx.matchCards, ctx.currentSeason,
    targetHkfcTeam, u21DoubleGameCount,
  );
  for (const w of sameDayWarnings) {
    if (!warnings.includes(w)) warnings.push(w);
  }
  t(`✓ Final — ${warnings.length > 0 ? "warning" : "eligible"} (${warnings.length} warning(s))`);
  return finish(nonBlockedResult(
    warnings.length > 0 ? "warning" : "eligible",
    warnings,
    playUpResult.playUpCount,
    sameDayResult.selectedByTeam,
    sameDayResult.sameDayHigherTeam,
  ));
}

// ── Main evaluation entry point (metrics-wrapped) ───────────────────────
/**
 * Full eligibility evaluation following the HKFC Eligibility & Selection
 * Rules Specification v1.0 §4 evaluation order (8 steps + warnings).
 * Steps are evaluated in sequence, short-circuiting on the first block.
 * ORDER IS FROZEN — do not reorder checks (Roadmap v3 Invariant #1).
 */
export function evaluatePlayerEligibility(
  player: Player,
  match: Match,
  ctx: EvaluationContext,
  opts?: { trace?: boolean },
): EligibilityResult {
  const startedAt = Date.now();
  const result = evaluateInternal(player, match, ctx, opts);
  recordEligibilityEvaluation({
    status: result.status,
    ruleId: result.ruleId,
    warningRuleIds: result.warningTags.map((w) => w.ruleId),
    durationMs: Date.now() - startedAt,
  });
  return result;
}