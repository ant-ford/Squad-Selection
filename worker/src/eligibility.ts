import { linkId } from "./airtable";
import type { Match, Player, SquadSelection } from "../../src/generated/domainTypes";

export interface EligibilityIssue {
  rule: string;
  reason: string;
}

export interface EligibilityResult {
  blocks: EligibilityIssue[];
  warnings: EligibilityIssue[];
  conflicts: { type: string; team: string; matchId: string }[];
}

/**
 * Ported as-is from the pre-migration src/api/getPlayersForMatch.ts. This is
 * an early/partial implementation of the eligibility rules described in
 * HKHA_Competition_Bye-Laws_Summary.md and Implementation_Roadmap_v2.md —
 * play-up counts, GK exemptions, U21 overrides, cup rules, and same-day
 * cross-team conflicts are Phase 3 work and were NOT implemented before this
 * migration either. This refactor moves the data access layer only; it does
 * not add or remove eligibility rules.
 */
export function evaluatePlayerEligibility(
  player: Player,
  match: Match,
  teamRankMap: Record<string, number>,
  existingSelections: SquadSelection[]
): EligibilityResult {
  const blocks: EligibilityIssue[] = [];
  const warnings: EligibilityIssue[] = [];
  const conflicts: { type: string; team: string; matchId: string }[] = [];

  // Suspension
  if (player.isSuspended || (player.matchesToServe && player.matchesToServe > 0)) {
    blocks.push({ rule: "SUSPENDED", reason: "Player is suspended" });
  }

  // Higher-to-lower movement (7.2a)
  const home = match.homeTeam || "";
  const away = match.awayTeam || "";
  const hkfcTeam = teamRankMap[home] !== undefined ? home : away;
  const targetTeamRank = teamRankMap[hkfcTeam] ?? 99;
  const playerTeamRank = teamRankMap[player.registeredTeam || ""] ?? 99;
  if (playerTeamRank < targetTeamRank) {
    blocks.push({ rule: "HIGHER_TO_LOWER", reason: "Higher-to-lower movement blocked (7.2a)" });
  }

  // Visiting player fixed team (6.4)
  if (player.isVisitingPlayer && player.registeredTeam !== hkfcTeam) {
    blocks.push({ rule: "VISITING_FIXED", reason: "Visiting player fixed to registered team (6.4)" });
  }

  // Duplicate selection guard for this match
  const alreadySelected = existingSelections.some((s) => {
    return linkId(s.player) === player.id && linkId(s.match) === match.id;
  });
  if (alreadySelected) {
    blocks.push({ rule: "DUPLICATE", reason: "Already selected for this match" });
  }

  // Same-day cross-team conflicts and play-up counting are not implemented
  // yet (see roadmap Phase 3) — carried over unchanged.

  return { blocks, warnings, conflicts };
}
