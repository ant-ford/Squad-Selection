import { describe, it, expect } from "vitest";
import { computeAutoSelectIds, type AutoSelectCandidate } from "../src/lib/autoSelect";

// ---------------------------------------------------------------------------
// Regression for bug F1: auto-select must run against the poll-merged player
// list, not the initial fetch snapshot - a player who becomes Available (or
// Unavailable) via the 30s poll must be added (or must not be added) on the
// very next auto-select pass. This tests the pure filter in isolation; the
// caller-side wiring in SquadSelection.tsx passes mergedPlayers, not
// data.players, into this function.
// ---------------------------------------------------------------------------

function candidate(overrides: Partial<AutoSelectCandidate> = {}): AutoSelectCandidate {
  return {
    id: "p1",
    eligibilityStatus: "eligible",
    availabilityStatus: "Available",
    selectionStatus: "",
    ...overrides,
  };
}

describe("computeAutoSelectIds", () => {
  it("adds a priority player who is eligible, available, and not yet selected", () => {
    const ids = computeAutoSelectIds([candidate({ id: "p1" })], new Set(["p1"]), new Set());
    expect(ids).toEqual(["p1"]);
  });

  it("adds a player who only just became Available (the poll-merge case)", () => {
    // Represents a player whose availabilityStatus flipped to 'Available'
    // after the poll merged in a fresher exception - the caller is
    // responsible for passing the merged list, this just proves the filter
    // itself picks them up once they qualify.
    const justBecameAvailable = candidate({ id: "p2", availabilityStatus: "Available" });
    const ids = computeAutoSelectIds([justBecameAvailable], new Set(["p2"]), new Set());
    expect(ids).toEqual(["p2"]);
  });

  it("does not add a player who is not on the priority list", () => {
    const ids = computeAutoSelectIds([candidate({ id: "p1" })], new Set(["someone-else"]), new Set());
    expect(ids).toEqual([]);
  });

  it("does not add a blocked player", () => {
    const ids = computeAutoSelectIds(
      [candidate({ id: "p1", eligibilityStatus: "blocked" })],
      new Set(["p1"]),
      new Set(),
    );
    expect(ids).toEqual([]);
  });

  it("accepts a warning-status player (not just eligible)", () => {
    const ids = computeAutoSelectIds(
      [candidate({ id: "p1", eligibilityStatus: "warning" })],
      new Set(["p1"]),
      new Set(),
    );
    expect(ids).toEqual(["p1"]);
  });

  it("does not add a player who is Unavailable or Maybe", () => {
    const ids = computeAutoSelectIds(
      [
        candidate({ id: "p1", availabilityStatus: "Unavailable" }),
        candidate({ id: "p2", availabilityStatus: "Maybe" }),
      ],
      new Set(["p1", "p2"]),
      new Set(),
    );
    expect(ids).toEqual([]);
  });

  it("does not re-add a player who is already Selected", () => {
    const ids = computeAutoSelectIds(
      [candidate({ id: "p1", selectionStatus: "Selected" })],
      new Set(["p1"]),
      new Set(),
    );
    expect(ids).toEqual([]);
  });

  it("does not add a player the coach manually suppressed", () => {
    const ids = computeAutoSelectIds([candidate({ id: "p1" })], new Set(["p1"]), new Set(["p1"]));
    expect(ids).toEqual([]);
  });

  it("returns an empty list when nothing qualifies", () => {
    expect(computeAutoSelectIds([], new Set(), new Set())).toEqual([]);
  });
});
