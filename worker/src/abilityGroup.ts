/**
 * Ability group and sub-group derivation from Section Rank.
 *
 * Given a player's rank, the total active count, and the group capacity
 * configuration, this module determines which ability group (A–H) and
 * sub-group (+/neutral/−) the player belongs to.
 *
 * Sub-group algorithm (per spec):
 *   k = floor(N_G / 3),  r = N_G mod 3
 *   r = 0 → plus = k,     neutral = k,     minus = k
 *   r = 1 → plus = k,     neutral = k + 1, minus = k
 *   r = 2 → plus = k + 1, neutral = k + 1, minus = k
 *
 * Within each group the top-ranked players receive "+", the middle
 * receive neutral, and the bottom receive "−".
 */
import type { AbilityGroupConfigMap } from "../../src/generated/domainTypes";

export type SubGroup = "plus" | "neutral" | "minus";

export interface AbilityAssignment {
  abilityGroup: string;
  abilitySubGroup: SubGroup;
  /** Combined display string, e.g. "A+", "B", "H-". */
  abilityDisplay: string;
}

const ORDERED_GROUPS = ["A", "B", "C", "D", "E", "F", "G"] as const;

/** Return a zeroed-out config map. */
export function emptyConfig(): AbilityGroupConfigMap {
  return { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
}

/**
 * Validate a proposed configuration against the active player count.
 * Returns an error string if invalid, or `null` if valid.
 */
export function validateConfig(
  config: AbilityGroupConfigMap,
  activeCount: number,
): string | null {
  let total = 0;
  for (const g of ORDERED_GROUPS) {
    const cap = config[g] ?? 0;
    if (!Number.isInteger(cap) || cap < 0) {
      return `Group ${g} capacity must be a non-negative integer`;
    }
    total += cap;
  }
  if (total > activeCount) {
    return `Total capacity (${total}) exceeds active player count (${activeCount})`;
  }
  return null;
}

/** Determine sub-group from a 0-based offset within a group of size nG. */
function computeSubGroup(offset: number, nG: number): SubGroup {
  const k = Math.floor(nG / 3);
  const r = nG % 3;

  let plus: number;
  let neutral: number;

  if (r === 0) {
    plus = k;
    neutral = k;
  } else if (r === 1) {
    plus = k;
    neutral = k + 1;
  } else {
    plus = k + 1;
    neutral = k + 1;
  }

  if (offset < plus) return "plus";
  if (offset < plus + neutral) return "neutral";
  return "minus";
}

function subGroupSuffix(sg: SubGroup): string {
  if (sg === "plus") return "+";
  if (sg === "minus") return "-";
  return "";
}

/**
 * Compute the ability group, sub-group, and display string for a player
 * at the given 1-based section rank.
 */
export function computeAbilityAssignment(
  rank: number,
  totalActive: number,
  config: AbilityGroupConfigMap,
): AbilityAssignment {
  let cursor = 0;

  for (const g of ORDERED_GROUPS) {
    const cap = Math.max(0, Math.floor(config[g] ?? 0));
    if (cap === 0) continue;

    const start = cursor + 1;
    const end = Math.min(cursor + cap, totalActive);

    if (rank >= start && rank <= end) {
      const nG = end - start + 1;
      const offset = rank - start;
      const sg = computeSubGroup(offset, nG);
      return {
        abilityGroup: g,
        abilitySubGroup: sg,
        abilityDisplay: `${g}${subGroupSuffix(sg)}`,
      };
    }

    cursor = end;
  }

  // Group H — residual
  const hStart = cursor + 1;
  const hEnd = totalActive;

  if (rank >= hStart && rank <= hEnd) {
    const nG = hEnd - hStart + 1;
    const offset = rank - hStart;
    const sg = computeSubGroup(offset, nG);
    return {
      abilityGroup: "H",
      abilitySubGroup: sg,
      abilityDisplay: `H${subGroupSuffix(sg)}`,
    };
  }

  // Fallback for out-of-range ranks (should not occur with valid data)
  return { abilityGroup: "H", abilitySubGroup: "neutral", abilityDisplay: "H" };
}