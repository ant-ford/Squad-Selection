import { describe, it, expect } from "vitest";
import { buildRecommendations, type RecommendationCandidate } from "../worker/src/recommendations";

function candidate(overrides: Partial<RecommendationCandidate> = {}): RecommendationCandidate {
  return {
    id: "p1", preferredName: "Test", playingPosition: "Defender", playingAbility: "B",
    playUpCount: 0, registeredTeam: "HKFC C", eligibilityStatus: "eligible",
    availabilityStatus: "Available", selectionStatus: "", ...overrides,
  };
}

describe("buildRecommendations", () => {
  it("measures play-up capacity against a U21's allowance of eight (Bye-Law 7.2(b))", () => {
    // Recommending for HKFC B (rank 2) from HKFC C (rank 3): a play-up.
    const pool = [
      candidate({ id: "std", preferredName: "Std", playUpCount: 3 }),
      candidate({ id: "u21", preferredName: "U21", playUpCount: 3, isU21: true }),
    ];
    const result = buildRecommendations(pool, 2, { "HKFC B": 2, "HKFC C": 3 });
    const byId = Object.fromEntries(result.map((r) => [r.id, r]));
    // Three play-ups exhausts a standard allowance but not a U21's.
    expect(byId.u21.score).toBeGreaterThan(byId.std.score);
    expect(byId.u21.reasons).toContain("Play-Up Capacity");
    expect(byId.std.reasons).toContain("Play-Up Capacity");

    const onFive = buildRecommendations([candidate({ playUpCount: 5, isU21: true })], 2, { "HKFC B": 2, "HKFC C": 3 });
    expect(onFive[0].reasons).toContain("Play-Up Capacity");
  });

  it("excludes blocked, unavailable, and already-selected players", () => {
    const pool = [
      candidate({ id: "a", eligibilityStatus: "blocked" }),
      candidate({ id: "b", availabilityStatus: "Unavailable" }),
      candidate({ id: "c", selectionStatus: "Selected" }),
      candidate({ id: "d" }),
    ];
    const result = buildRecommendations(pool, 3, { "HKFC C": 3 });
    expect(result.map(r => r.id)).toEqual(["d"]);
  });

  it("ranks higher ability above lower ability at equal other factors", () => {
    const pool = [
      candidate({ id: "low", playingAbility: "H" }),
      candidate({ id: "high", playingAbility: "A+" }),
    ];
    const result = buildRecommendations(pool, 3, { "HKFC C": 3 });
    expect(result[0].id).toBe("high");
  });

  it("prefers players covering the needed position when specified", () => {
    const pool = [
      candidate({ id: "wrong-pos", playingPosition: "Forward", playingAbility: "A+" }),
      candidate({ id: "right-pos", playingPosition: "Defender", playingAbility: "C" }),
    ];
    const result = buildRecommendations(pool, 3, { "HKFC C": 3 }, { neededPosition: "Defender" });
    expect(result[0].id).toBe("right-pos");
  });

  it("does not penalise position when no position filter is active (neutral)", () => {
    const pool = [
      candidate({ id: "fwd", preferredName: "Bea", playingPosition: "Forward", playingAbility: "B" }),
      candidate({ id: "def", preferredName: "Alice", playingPosition: "Defender", playingAbility: "B" }),
    ];
    const result = buildRecommendations(pool, 3, { "HKFC C": 3 });
    // Equal scores — tiebreak is alphabetical by name, not insertion order
    expect(result[0].id).toBe("def");
    expect(result[0].score).toBe(result[1].score);
  });

  it("penalises higher play-up counts", () => {
    const pool = [
      candidate({ id: "fresh", playUpCount: 0 }),
      candidate({ id: "used", playUpCount: 3 }),
    ];
    const result = buildRecommendations(pool, 3, { "HKFC C": 3 });
    expect(result[0].id).toBe("fresh");
  });

  it("respects the limit option", () => {
    const pool = Array.from({ length: 20 }, (_, i) => candidate({ id: `p${i}` }));
    const result = buildRecommendations(pool, 3, { "HKFC C": 3 }, { limit: 5 });
    expect(result).toHaveLength(5);
  });

  it("produces stable, deterministic ordering (tiebreak on name)", () => {
    const pool = [
      candidate({ id: "z", preferredName: "Zoe", playingAbility: "B" }),
      candidate({ id: "a", preferredName: "Amy", playingAbility: "B" }),
      candidate({ id: "m", preferredName: "Mia", playingAbility: "B" }),
    ];
    const result = buildRecommendations(pool, 3, { "HKFC C": 3 });
    expect(result.map(r => r.preferredName)).toEqual(["Amy", "Mia", "Zoe"]);
  });

  it("gives Flexible/Varies players a partial position score", () => {
    const pool = [
      candidate({ id: "flex", playingPosition: "Flexible/Varies", playingAbility: "C" }),
      candidate({ id: "exact", playingPosition: "Defender", playingAbility: "C" }),
    ];
    const result = buildRecommendations(pool, 3, { "HKFC C": 3 }, { neededPosition: "Defender" });
    expect(result[0].id).toBe("exact");
    expect(result[1].id).toBe("flex");
  });

  it("score is 0-100 range", () => {
    const pool = [
      candidate({ id: "max", playingAbility: "A+", playUpCount: 0, registeredTeam: "HKFC C" }),
      candidate({ id: "min", playingAbility: "H-", playUpCount: 3, registeredTeam: "HKFC Z" }),
    ];
    const result = buildRecommendations(pool, 3, { "HKFC C": 3, "HKFC Z": 10 });
    expect(result[0].score).toBeGreaterThanOrEqual(0);
    expect(result[0].score).toBeLessThanOrEqual(100);
    expect(result[1].score).toBeGreaterThanOrEqual(0);
    expect(result[1].score).toBeLessThanOrEqual(100);
  });

  it("generates reason tags for top candidates", () => {
    const pool = [
      candidate({ id: "star", playingAbility: "A+", playUpCount: 0, registeredTeam: "HKFC C" }),
    ];
    const result = buildRecommendations(pool, 3, { "HKFC C": 3 });
    expect(result[0].reasons.length).toBeGreaterThan(0);
    expect(result[0].reasons.length).toBeLessThanOrEqual(3);
  });

  it("handles empty candidate pool", () => {
    const result = buildRecommendations([], 3, { "HKFC C": 3 });
    expect(result).toEqual([]);
  });

  it("closer team distance scores higher", () => {
    const pool = [
      candidate({ id: "far", playingAbility: "B", registeredTeam: "HKFC E" }),
      candidate({ id: "near", playingAbility: "B", registeredTeam: "HKFC C" }),
    ];
    const result = buildRecommendations(pool, 3, { "HKFC C": 3, "HKFC E": 5 });
    expect(result[0].id).toBe("near");
  });

  it("uses the authoritative Team Rank when the candidate team resolves", () => {
    const pool = [candidate({ id: "same", playingAbility: "B", registeredTeam: "HKFC C" })];
    const result = buildRecommendations(pool, 3, { "HKFC C": 3 });
    // B = 20 -> ability (20/24*60) + position 20 (neutral) + proximity 10 (same team) + play-up 10
    expect(result[0].score).toBe(Math.round((20 / 24) * 60 + 20 + 10 + 10));
    expect(result[0].score).toBe(90);
  });

  it("does not fabricate a team rank when the candidate team is unknown", () => {
    const pool = [
      candidate({ id: "known", playingAbility: "B", registeredTeam: "HKFC C" }),
      candidate({ id: "unknown-team", playingAbility: "B", registeredTeam: "Unlisted 9s" }),
    ];
    const result = buildRecommendations(pool, 3, { "HKFC C": 3 });
    const byId = Object.fromEntries(result.map((r) => [r.id, r]));
    // The same-team candidate keeps its 10-point proximity credit; the
    // unknown team is not silently treated as the target team (which would
    // have fabricated distance 0 / full proximity points).
    expect(byId["known"].score - byId["unknown-team"].score).toBe(10);
  });

  // The HKFC F list of 27 Sep 2026: players shown in a team above ranked
  // below much weaker F and G players, because being from above earned no
  // proximity credit at all.
  describe("players shown in a team above the fixture", () => {
    const ranks = { "HKFC D": 4, "HKFC E": 5, "HKFC F": 6, "HKFC G": 7 };

    it("rank on ability over weaker players of the target team and below", () => {
      const pool = [
        candidate({ id: "own-E-", preferredName: "Pagey", playingAbility: "E-", registeredTeam: "HKFC F" }),
        candidate({ id: "above-D-", preferredName: "Guillaume", playingAbility: "D-", registeredTeam: "HKFC E" }),
        candidate({ id: "above-C-", preferredName: "Boulty", playingAbility: "C-", registeredTeam: "HKFC D" }),
        candidate({ id: "up-G+", preferredName: "Anson", playingAbility: "G+", registeredTeam: "HKFC G" }),
      ];
      const order = buildRecommendations(pool, 6, ranks).map((r) => r.id);
      expect(order).toEqual(["above-C-", "above-D-", "own-E-", "up-G+"]);
    });

    it("sit just behind the target team's own player of the same grade", () => {
      const pool = [
        candidate({ id: "above", preferredName: "Aaron", playingAbility: "E-", registeredTeam: "HKFC E" }),
        candidate({ id: "own", preferredName: "Zed", playingAbility: "E-", registeredTeam: "HKFC F" }),
        candidate({ id: "own-weaker", preferredName: "Abe", playingAbility: "F", registeredTeam: "HKFC F" }),
      ];
      const order = buildRecommendations(pool, 6, ranks).map((r) => r.id);
      expect(order).toEqual(["own", "above", "own-weaker"]);
    });
  });

  describe("includeSelected", () => {
    const pool = [
      candidate({ id: "picked", preferredName: "Amy", selectionStatus: "Selected" }),
      candidate({ id: "free", preferredName: "Bea" }),
    ];

    it("leaves the current squad out by default", () => {
      expect(buildRecommendations(pool, 3, { "HKFC C": 3 }).map((r) => r.id)).toEqual(["free"]);
    });

    it("ranks the current squad too, so a player taken out keeps a place", () => {
      const ids = buildRecommendations(pool, 3, { "HKFC C": 3 }, { includeSelected: true }).map((r) => r.id);
      expect(ids).toEqual(["picked", "free"]);
    });

    it("still leaves out blocked and unavailable players", () => {
      const withOthers = [
        ...pool,
        candidate({ id: "blocked", eligibilityStatus: "blocked", selectionStatus: "Selected" }),
        candidate({ id: "out", availabilityStatus: "Unavailable" }),
      ];
      const ids = buildRecommendations(withOthers, 3, { "HKFC C": 3 }, { includeSelected: true }).map((r) => r.id);
      expect(ids).toEqual(["picked", "free"]);
    });
  });
});
