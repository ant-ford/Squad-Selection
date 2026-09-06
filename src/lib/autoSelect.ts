export interface AutoSelectCandidate {
  id: string;
  eligibilityStatus: string;
  availabilityStatus: string;
  selectionStatus: string;
}

/**
 * Player ids that auto-select should add: on the priority list, not blocked,
 * actually Available, not already selected, and not manually suppressed by
 * the coach removing them earlier in this session.
 *
 * Callers MUST pass the poll-merged player list (availability reflects the
 * latest 30s poll), not the initial fetch snapshot - a player who becomes
 * Available after the initial load must still be auto-added.
 */
export function computeAutoSelectIds(
  players: AutoSelectCandidate[],
  priorityPlayerIds: Set<string>,
  suppressedPlayerIds: Set<string>,
): string[] {
  return players
    .filter(
      (p) =>
        priorityPlayerIds.has(p.id) &&
        (p.eligibilityStatus === "eligible" || p.eligibilityStatus === "warning") &&
        p.availabilityStatus === "Available" &&
        p.selectionStatus !== "Selected" &&
        !suppressedPlayerIds.has(p.id),
    )
    .map((p) => p.id);
}
