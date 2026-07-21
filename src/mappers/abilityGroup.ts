import type { AbilityGroupConfigMap } from "../generated/domainTypes";

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
 * Derives the ability assignment for a player given their 1-based section rank,
 * total active player count, and group capacity configuration.
 */
export function getAbilityAssignment(
  sectionRank: number,
  activeCount: number,
  config: AbilityGroupConfigMap
): AbilityAssignment {
  if (!sectionRank || sectionRank < 1) {
    return { abilityGroup: "H", abilitySubGroup: "neutral", abilityDisplay: "H" };
  }

  let currentRankStart = 1;

  for (const group of ORDERED_GROUPS) {
    const capacity = config[group] ?? 0;
    const groupEnd = currentRankStart + capacity - 1;

    if (sectionRank <= groupEnd) {
      const offset = sectionRank - currentRankStart;
      const subGroup = computeSubGroup(offset, capacity);
      const suffix = subGroupSuffix(subGroup);
      return {
        abilityGroup: group,
        abilitySubGroup: subGroup,
        abilityDisplay: `${group}${suffix}`,
      };
    }

    currentRankStart += capacity;
  }

  // Players ranked beyond configured capacities fall into Group H (Residual)
  const residualCapacity = Math.max(0, activeCount - (currentRankStart - 1));
  const offset = sectionRank - currentRankStart;
  const subGroup = residualCapacity > 0 ? computeSubGroup(offset, residualCapacity) : "neutral";
  const suffix = subGroupSuffix(subGroup);

  return {
    abilityGroup: "H",
    abilitySubGroup: subGroup,
    abilityDisplay: `H${suffix}`,
  };
}