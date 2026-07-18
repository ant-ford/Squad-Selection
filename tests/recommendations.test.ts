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
});
