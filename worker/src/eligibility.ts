import { linkId } from "./airtable";
import { isFriendly, isQualifyingPlayUpCard } from "./playUp";
import { hkfcSides } from "./match";
import { UNRANKED_TEAM_RANK } from "./reference";
import type { CardSuspensionState } from "./suspension";
import type { Match, MatchCard, Player, Team } from "../../shared/schema/domainTypes";

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
  /** Stable internal ID of the blocking rule; null when not blocked. */
  ruleId: string | null;
}

/** A blocking rule's outcome: its stable ID paired with the coach-facing reason. */
interface RuleBlock {
  ruleId: string;
  reason: string;
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
type SameDayTeamFixture = { matchId: string; teamName: string };

function buildRankMap(teamMap: TeamMap): RankMap {
  const rm: RankMap = {};
  for (const [name, t] of teamMap.entries()) {
    rm[name] = t.teamRank ?? UNRANKED_TEAM_RANK;
  }
  return rm;
}

function selectionKey(matchId: string, teamName: string): string {
  return `${matchId}:${teamName}`;
}

function cardsForPlayer(playerId: string, ctx: EvaluationContext): MatchCard[] {
  return ctx.matchCardsByPlayer.get(playerId) ?? [];
}

function matchForCard(card: MatchCard, ctx: EvaluationContext): Match | undefined {
  const matchId = linkId(card.match);
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
  const sides = hkfcSides(match, new Set(Object.keys(rankMap)));
  if (sides.home) return sides.home.team;
  if (sides.away) return sides.away.team;
  const home = match.homeTeam || "";
  const away = match.awayTeam || "";
  if (home) return home;
  if (away) return away;
  return null;
}

function playerRanks(
  p: Player,
  rankMap: RankMap,
): { playerRank: number; isPremier: boolean } {
  const team = p.registeredTeam || "";
  const rank = rankMap[team] ?? UNRANKED_TEAM_RANK;
  const isPremier = rank === 1;
  return { playerRank: rank, isPremier };
}

function teamRanks(
  teamName: string,
  rankMap: RankMap,
  teamMap: TeamMap,
): { rank: number; isPremier: boolean } {
  const rank = rankMap[teamName] ?? UNRANKED_TEAM_RANK;
  const team = teamMap.get(teamName);
  const isPremier = team?.isPremier === true || rank === 1;
  return { rank, isPremier };
}

// ── Step 1: Admin Data Validation (§2.2) ────────────────────────────────
function checkAdminData(player: Player): RuleBlock | null {
  const reason = "Admin data incomplete";
  if (!player.active) return { ruleId: RULE_IDS.ADMIN_DATA_INCOMPLETE, reason };
  if (!player.registeredTeam) return { ruleId: RULE_IDS.ADMIN_DATA_INCOMPLETE, reason };
  if (!player.playingPosition) return { ruleId: RULE_IDS.ADMIN_DATA_INCOMPLETE, reason };
  if (!player.playingAbility) return { ruleId: RULE_IDS.ADMIN_DATA_INCOMPLETE, reason };
  return null;
}

// ── Step 2: Suspension (§5) ─────────────────────────────────────────────
function checkSuspension(player: Player, ctx: EvaluationContext): RuleBlock | null {
  // Manual disciplinary suspension and the automatically calculated card
  // suspension are independent - either blocks the player, neither clears
  // the other.
  const block = { ruleId: RULE_IDS.SUSPENSION, reason: "Suspended" };
  if (player.isSuspended === true) return block;
  if ((player.matchesToServe ?? 0) > 0) return block;
  const automatic = ctx.suspensionByPlayer?.get(player.id);
  if (automatic?.active) return block;
  return null;
}

// ── Step 3: Visiting Player Restrictions (§6) ───────────────────────────
function checkVisitingPlayer(
  player: Player,
  targetHkfcTeam: string,
  match: Match,
  ctx: EvaluationContext,
): RuleBlock | null {
  if (!player.isVisitingPlayer) return null;
  if (player.registeredTeam !== targetHkfcTeam) {
    return { ruleId: RULE_IDS.VISITING_FIXED_TEAM, reason: "Visiting player — fixed to registered team" };
  }
  if (isCup(match)) {
    // Spec §6.3: five appearances FOR THE REGISTERED TEAM.
    // Friendlies are not appearances and never count towards the threshold.
    const appearances = cardsForPlayer(player.id, ctx).filter(
      (card) =>
        card.season === ctx.currentSeason &&
        card.team === player.registeredTeam &&
        !isFriendly(matchForCard(card, ctx)),
    ).length;
    if (appearances < 5) {
      return {
        ruleId: RULE_IDS.VISITING_CUP_APPEARANCES,
        reason: "Visiting player — fewer than 5 appearances for registered team",
      };
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
  block: RuleBlock | null;
  selectedByTeam: string | null;
  sameDayHigherTeam: string | null;
  warnings: string[];
} {
  let selectedByTeam: string | null = null;
  let sameDayHigherTeam: string | null = null;
  const warnings: string[] = [];
  const availableForTeams: string[] = [];
  const playerSelections = ctx.selectionsByPlayer.get(player.id);
  const playerRank = playerRanks(player, rankMap).playerRank;

  /**
   * Same-day availability is reported as ONE warning naming every higher
   * team, not one warning per team. A player registered to a low team can be
   * available for most of the club on a busy Saturday, and a chip per team
   * buried everything else on their row.
   *
   * Teams are ordered by rank so the strongest side reads first. With a
   * single team the string is byte-identical to the previous wording, which
   * is what the golden matrix pins.
   */
  const withAvailabilityWarning = (): string[] => {
    if (availableForTeams.length === 0) return warnings;
    const ordered = [...availableForTeams].sort(
      (a, b) => (rankMap[a] ?? UNRANKED_TEAM_RANK) - (rankMap[b] ?? UNRANKED_TEAM_RANK),
    );
    return [...warnings, `Available for ${ordered.join(", ")} on same day`];
  };

  for (const fixture of ctx.sameDayFixtures) {
    const sdmTeam = fixture.teamName;
    if (!sdmTeam) continue;
    const sdmRank = rankMap[sdmTeam] ?? UNRANKED_TEAM_RANK;
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
      // An actual selection for a higher team makes the player unavailable
      // for lower-team fixtures that day (§7.2).
      return {
        block: { ruleId: RULE_IDS.SAME_DAY_SELECTED, reason: `Selected for ${sdmTeam} on same day` },
        selectedByTeam: sdmTeam,
        sameDayHigherTeam: sdmTeam,
        warnings: withAvailabilityWarning(),
      };
    }
    // Product decision 2026-09-03: mere AVAILABILITY for a higher team no
    // longer locks the player out of lower-team fixtures - the player remains
    // selectable by their own team. Surfaced as a planning warning instead;
    // the exception model and selection-time rules are unchanged.
    if (!availableForTeams.includes(sdmTeam)) {
      availableForTeams.push(sdmTeam);
    }
    // Unavailable exception for the higher fixture releases the lock.
  }

  return {
    block: null,
    selectedByTeam,
    sameDayHigherTeam,
    warnings: withAvailabilityWarning(),
  };
}

// ── Step 5: Premier Division Restrictions (§8) ──────────────────────────
function checkPremierRestriction(
  player: Player,
  targetHkfcTeam: string,
  targetIsPremier: boolean,
  ctx: EvaluationContext,
  rankMap: RankMap,
): RuleBlock | null {
  const { isPremier: playerIsPremier } = playerRanks(player, rankMap);
  // Only applies when crossing Premier ↔ non-Premier boundary
  if (targetIsPremier === playerIsPremier) return null;
  const targetCompleted = countCompletedMatches(targetHkfcTeam, ctx);
  const playerCompleted = countCompletedMatches(
    player.registeredTeam || "",
    ctx,
  );
  if (targetCompleted < 3 || playerCompleted < 3) {
    return {
      ruleId: RULE_IDS.PREMIER_MOVEMENT,
      reason: "Premier movement restriction — team has not completed 3 matches",
    };
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
    const cardMatchId = linkId(card.match);
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
): { block: RuleBlock | null; playUpCount: number } {
  const playUpCount = calculatePlayUpCount(player, ctx);
  // §9.1 — Higher-to-lower movement blocked
  if (playerRank < targetRank) {
    return {
      block: { ruleId: RULE_IDS.HIGHER_TO_LOWER, reason: "Higher-to-lower movement requires Committee approval" },
      playUpCount,
    };
  }
  // §9.2 / §13 — Lower-to-higher: play-up limit at 4
  if (targetRank < playerRank) {
    if (playUpCount >= 4) {
      return {
        block: { ruleId: RULE_IDS.PLAYUP_LIMIT, reason: "Play-up limit reached — re-registration required" },
        playUpCount,
      };
    }
  }
  return { block: null, playUpCount };
}

function calculatePlayUpCount(
  player: Player,
  ctx: EvaluationContext,
): number {
  // Single authoritative qualifying play-up definition (shared with the
  // automatic re-registration service and the Play-Up Watch dashboard).
  return cardsForPlayer(player.id, ctx).filter(
    (mc) => isQualifyingPlayUpCard(mc, ctx.currentSeason, ctx.matchesById),
  ).length;
}

// ── Step 7: Cup Eligibility (§14) ──────────────────────────────────────
function checkCupEligibility(
  player: Player,
  match: Match,
  targetTeam: string,
  ctx: EvaluationContext,
): RuleBlock | null {
  if (!isCup(match)) return null;
  // §14.1 — Premier Division Cup Ban
  if (player.everRegisteredToPremier === true) {
    return { ruleId: RULE_IDS.CUP_BAN_PREMIER, reason: "Cup ban — ever registered to Premier Division" };
  }
  // §14.2 — Minimum 2 league appearances
  const cards = cardsForPlayer(player.id, ctx);
  const leagueApps = cards.filter((card) => isLeague(matchForCard(card, ctx))).length;
  if (leagueApps < 2) {
    return {
      ruleId: RULE_IDS.CUP_MIN_LEAGUE_APPEARANCES,
      reason: "Fewer than 2 league appearances — ineligible for Cup",
    };
  }
  // §14.3 — Cross-cup restriction
  const otherTeamCupCard = cards.find((card) =>
    card.team !== targetTeam && isCup(matchForCard(card, ctx)),
  );
  if (otherTeamCupCard) {
    const otherTeam = otherTeamCupCard.team || "another team";
    return { ruleId: RULE_IDS.CROSS_CUP, reason: `Already played in a Cup for ${otherTeam} this season` };
  }
  return null;
}

// ── Step 8: U21 Double-Game Limits (§12.3) ─────────────────────────────
function checkU21DoubleGame(
  player: Player,
  targetHkfcTeam: string,
  ctx: EvaluationContext,
): RuleBlock | null {
  if (!player.u21Eligible) return null;
  if (targetHkfcTeam === player.registeredTeam) return null;
  const count = indexedU21DoubleGameCount(targetHkfcTeam, ctx);
  if (count === null) return null;
  const alreadySelected = ctx.sameDaySelectionsByTeam.get(targetHkfcTeam)?.has(player.id) ?? false;
  return count >= 3 && !alreadySelected
    ? { ruleId: RULE_IDS.U21_DOUBLE_GAME_LIMIT, reason: "U21 double-game limit reached" }
    : null;
}

// ── Warnings (§16) ─────────────────────────────────────────────────────
function generateWarnings(
  player: Player,
  playUpCount: number,
  matchCards: MatchCard[],
  currentSeason: string,
  targetHkfcTeam: string,
  u21DoubleGameCount: number,
  matchesById: Map<string, Match>,
): string[] {
  const warnings: string[] = [];
  if (playUpCount === 2) {
    warnings.push("Second play-up appearance");
  } else if (playUpCount === 3) {
    warnings.push("Third play-up appearance");
  }
  if (player.isVisitingPlayer) {
    const apps = matchCards.filter((mc) => {
      const pId = linkId(mc.player);
      return (
        pId === player.id &&
        mc.team === player.registeredTeam &&
        mc.season === currentSeason &&
        // Mirrors the blocking check above: friendlies are not appearances.
        !isFriendly(matchesById.get(linkId(mc.match) ?? ""))
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
function blockedResult(block: RuleBlock, extras?: Partial<EligibilityResult>): EligibilityResult {
  return {
    status: "blocked",
    reason: block.reason,
    ruleId: block.ruleId,
    warnings: [],
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
    ruleId: null,
    warnings,
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
  sameDayFixtures: SameDayTeamFixture[];
  selectionsByPlayer: Map<string, Set<string>>;
  sameDaySelectionsByTeam: Map<string, Set<string>>;
  unavailablePlayerMatchKeys: Set<string>;
  matchCards: MatchCard[];
  matchCardsByPlayer: Map<string, MatchCard[]>;
  matchesById: Map<string, Match>;
  currentSeason: string;
  playersById: Map<string, Player>;
  completedLeagueMatchesByTeam: Map<string, number>;
  suspensionByPlayer?: Map<string, CardSuspensionState>;
}

// ── Main evaluation entry point ─────────────────────────────────────────
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
): EligibilityResult {
  const effectiveRankMap = ctx.rankMap;
  const targetHkfcTeam = ctx.targetTeam ?? hkfcTeamNameSafe(match, effectiveRankMap);
  if (!targetHkfcTeam || effectiveRankMap[targetHkfcTeam] === undefined) {
    return blockedResult({ ruleId: RULE_IDS.ADMIN_DATA_INCOMPLETE, reason: "Admin data incomplete" });
  }
  const { rank: targetRank, isPremier: targetIsPremier } = teamRanks(
    targetHkfcTeam, effectiveRankMap, ctx.teamMap,
  );
  const { playerRank } = playerRanks(player, effectiveRankMap);

  // ── Step 1: Admin Data Validation ──
  const adminBlock = checkAdminData(player);
  if (adminBlock) return blockedResult(adminBlock);

  // ── Step 2: Suspension ──
  const suspensionBlock = checkSuspension(player, ctx);
  if (suspensionBlock) return blockedResult(suspensionBlock);

  // ── Step 3: Visiting Player ──
  const visitingBlock = checkVisitingPlayer(player, targetHkfcTeam, match, ctx);
  if (visitingBlock) return blockedResult(visitingBlock);

  // ── Step 4: Same-Day Movement ──
  const sameDayResult = checkSameDayMovement(
    player, targetHkfcTeam, targetRank, effectiveRankMap, ctx,
  );
  if (sameDayResult.block) {
    return blockedResult(sameDayResult.block, {
      selectedByTeam: sameDayResult.selectedByTeam,
      sameDayHigherTeam: sameDayResult.sameDayHigherTeam,
    });
  }
  const sameDayWarnings = sameDayResult.warnings;

  // ── Step 5: Premier Division Restriction (evaluated before play-up rules,
  //    regardless of movement direction — Spec §4 / §8) ──
  const premierBlock = checkPremierRestriction(
    player, targetHkfcTeam, targetIsPremier, ctx, effectiveRankMap,
  );
  if (premierBlock) {
    return blockedResult(premierBlock, {
      selectedByTeam: sameDayResult.selectedByTeam,
      sameDayHigherTeam: sameDayResult.sameDayHigherTeam,
    });
  }

  // ── Step 6: Play-Up Rules ──
  const playUpResult = checkPlayUpRules(player, targetRank, playerRank, ctx);
  if (playUpResult.block) {
    return blockedResult(playUpResult.block, {
      playUpCount: playUpResult.playUpCount,
      selectedByTeam: sameDayResult.selectedByTeam,
      sameDayHigherTeam: sameDayResult.sameDayHigherTeam,
    });
  }

  // ── Step 7: Cup Eligibility ──
  const cupBlock = checkCupEligibility(player, match, targetHkfcTeam, ctx);
  if (cupBlock) {
    return blockedResult(cupBlock, {
      playUpCount: playUpResult.playUpCount,
      selectedByTeam: sameDayResult.selectedByTeam,
      sameDayHigherTeam: sameDayResult.sameDayHigherTeam,
    });
  }

  // ── Step 8: U21 Double-Game ──
  const u21Block = checkU21DoubleGame(player, targetHkfcTeam, ctx);
  if (u21Block) {
    return blockedResult(u21Block, {
      playUpCount: playUpResult.playUpCount,
      selectedByTeam: sameDayResult.selectedByTeam,
      sameDayHigherTeam: sameDayResult.sameDayHigherTeam,
    });
  }

  // ── Count U21 double-games for warning threshold ──
  const u21DoubleGameCount = indexedU21DoubleGameCount(targetHkfcTeam, ctx) ?? 0;

  // ── Generate Warnings ──
  const warnings = generateWarnings(
    player, playUpResult.playUpCount, ctx.matchCards, ctx.currentSeason,
    targetHkfcTeam, u21DoubleGameCount, ctx.matchesById,
  );
  for (const w of sameDayWarnings) {
    if (!warnings.includes(w)) warnings.push(w);
  }
  return nonBlockedResult(
    warnings.length > 0 ? "warning" : "eligible",
    warnings,
    playUpResult.playUpCount,
    sameDayResult.selectedByTeam,
    sameDayResult.sameDayHigherTeam,
  );
}