import { describe, it, expect } from "vitest";
import {
  getReversalAdvisory,
  formatAge,
  formatAbsolute,
} from "../src/lib/rankingHistory";
import type { RankingChange } from "../src/lib/queries";

function change(overrides: Partial<RankingChange>): RankingChange {
  return {
    id: "recE1",
    playerId: "recBob",
    kind: "move",
    playerName: "Bob",
    actorName: "Coach A",
    oldRank: 10,
    newRank: 3,
    note: "",
    at: "2026-08-10T08:00:00.000Z",
    ...overrides,
  };
}

describe("getReversalAdvisory", () => {
  it("returns the most recent event for the player (matched by stable player id)", () => {
    const events = [
      change({ id: "e1", playerId: "recBob", at: "2026-08-01T00:00:00.000Z" }),
      change({ id: "e2", playerId: "recBob", at: "2026-08-10T00:00:00.000Z", newRank: 1 }),
      change({ id: "e3", playerId: "recAlice", at: "2026-08-11T00:00:00.000Z" }),
    ];
    expect(getReversalAdvisory(events, "recBob")?.id).toBe("e2");
  });

  it("ignores deactivations", () => {
    const events = [
      change({ id: "e1", playerId: "recBob", kind: "deactivate", oldRank: 3, newRank: null }),
    ];
    expect(getReversalAdvisory(events, "recBob")).toBeNull();
  });

  it("returns null when the player has no events", () => {
    expect(getReversalAdvisory([change({ playerId: "recAlice" })], "recBob")).toBeNull();
  });

  it("returns null for empty history", () => {
    expect(getReversalAdvisory([], "recBob")).toBeNull();
  });

  it("distinguishes two players who share the same display name by their stable ids", () => {
    const events = [
      change({
        id: "e1",
        playerId: "recP1",
        playerName: "Alex Smith",
        at: "2026-08-10T00:00:00.000Z",
        oldRank: 5,
        newRank: 1,
      }),
      change({
        id: "e2",
        playerId: "recP2",
        playerName: "Alex Smith",
        at: "2026-08-12T00:00:00.000Z",
        oldRank: 2,
        newRank: 9,
      }),
    ];
    // Name-based matching would return e2 for BOTH players; id-based
    // matching must return each player's own most recent event.
    expect(getReversalAdvisory(events, "recP1")?.id).toBe("e1");
    expect(getReversalAdvisory(events, "recP2")?.id).toBe("e2");
  });
});

describe("formatAge", () => {
  const now = new Date("2026-08-14T08:00:00.000Z");
  it("renders relative age", () => {
    expect(formatAge("2026-08-11T08:00:00.000Z", now)).toBe("3 days ago");
    expect(formatAge("2026-08-14T07:00:00.000Z", now)).toBe("1 hour ago");
  });
  it("falls back to the raw value when unparseable", () => {
    expect(formatAge("nonsense", now)).toBe("nonsense");
    expect(formatAge("", now)).toBe("");
  });
});

describe("formatAbsolute", () => {
  it("renders an absolute date with time", () => {
    expect(formatAbsolute("2026-08-12T14:30:00.000Z")).toBe("12 Aug 2026, 14:30");
  });
  it("falls back for unparseable input", () => {
    expect(formatAbsolute("nonsense")).toBe("nonsense");
  });
});
