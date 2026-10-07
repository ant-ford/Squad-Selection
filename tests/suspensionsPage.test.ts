import { describe, expect, it } from "vitest";
import {
  closedHow,
  draftFrom,
  draftFromFlag,
  draftProblem,
  FLAG_REASON,
  emptyDraft,
  isDirty,
  leftLabel,
  newSuspension,
  personSuspensions,
  queueLabel,
  queuePositions,
  stepMatches,
  suspensionChange,
} from "../src/lib/suspensions";
import { officerItems } from "../src/components/headerItems";
import type { SuspensionRow } from "../src/api/suspensions";

const row = (over: Partial<SuspensionRow> = {}): SuspensionRow => ({
  id: "s1",
  player: "p1",
  name: "Pat Example",
  servingTeam: "HKFC C",
  matches: 3,
  fromDate: "2026-10-01",
  reason: "Red card",
  served: 1,
  remaining: 2,
  active: true,
  servedOn: null,
  createdAt: "2026-10-01T10:00:00Z",
  createdBy: null,
  clearedAt: null,
  clearedBy: null,
  clearReason: null,
  ...over,
});

describe("the left chip", () => {
  it("reads N of M left", () => {
    expect(leftLabel({ matches: 3, remaining: 2 })).toEqual({ label: "2 of 3 left", tone: "warning" });
    expect(leftLabel({ matches: 1, remaining: 1 }).label).toBe("1 of 1 left");
  });

  it("reads Until cleared for an open-ended one", () => {
    expect(leftLabel({ matches: null, remaining: null })).toEqual({ label: "Until cleared", tone: "danger" });
  });

  it("stays within 0..matches", () => {
    expect(leftLabel({ matches: 2, remaining: 0 })).toEqual({ label: "0 of 2 left", tone: "success" });
    expect(leftLabel({ matches: 2, remaining: 5 }).label).toBe("2 of 2 left");
    expect(leftLabel({ matches: 2, remaining: null }).label).toBe("2 of 2 left");
  });
});

describe("the queue", () => {
  it("numbers a player's suspensions in the API's order, and leaves single ones alone", () => {
    const q = queuePositions([
      { id: "a", player: "p1" },
      { id: "b", player: "p2" },
      { id: "c", player: "p1" },
    ]);
    expect(q.get("a")).toEqual({ pos: 1, of: 2 });
    expect(q.get("c")).toEqual({ pos: 2, of: 2 });
    expect(q.has("b")).toBe(false);
    expect(queueLabel(q.get("a"))).toBe("Serving 1 of 2");
    expect(queueLabel(q.get("c"))).toBe("Queued 2 of 2");
    expect(queueLabel(undefined)).toBeNull();
  });
});

describe("closed ones", () => {
  it("say Cleared with the clear date, or Served with the served date", () => {
    expect(closedHow({ clearedAt: "2026-10-03T09:00:00Z", servedOn: null })).toEqual({ label: "Cleared", date: "2026-10-03T09:00:00Z" });
    expect(closedHow({ clearedAt: null, servedOn: "2026-10-04" })).toEqual({ label: "Served", date: "2026-10-04" });
  });
});

describe("the matches stepper", () => {
  it("steps within 1 to 10", () => {
    expect(stepMatches(1, -1)).toBe(1);
    expect(stepMatches(1, 1)).toBe(2);
    expect(stepMatches(10, 1)).toBe(10);
  });

  it("steps from Until cleared to the top of the range", () => {
    expect(stepMatches(null, -1)).toBe(10);
    expect(stepMatches(null, 1)).toBe(10);
  });
});

describe("one person's suspensions", () => {
  it("cuts the board to them: open, recently closed, cards and an old flag", () => {
    const board = {
      open: [row({ id: "o1" }), row({ id: "o2", player: "p2" })],
      cleared: [row({ id: "c1", servedOn: "2026-09-26", active: false })],
      cards: [{ player: "p1", name: "Pat Example", servingTeam: "HKFC C", remainingMatches: 1, points: 5, dcReferral: false, indeterminate: false }],
      legacy: [{ player: "p2", name: "Kim Ho", team: null, isSuspended: true, matchesToServe: null }],
    };
    const mine = personSuspensions(board, "p1");
    expect(mine.open.map((s) => s.id)).toEqual(["o1"]);
    expect(mine.cleared.map((s) => s.id)).toEqual(["c1"]);
    expect(mine.card?.points).toBe(5);
    expect(mine.flag).toBeNull();
    expect(personSuspensions(board, "p2").flag?.name).toBe("Kim Ho");
    expect(personSuspensions(board, "p3")).toEqual({ open: [], cleared: [], card: null, flag: null });
  });
});

describe("the sheet", () => {
  it("starts with 1 match from today, and needs a player and a reason", () => {
    const d = emptyDraft("2026-10-06");
    expect(d).toEqual({ playerId: null, matches: 1, fromDate: "2026-10-06", reason: "" });
    expect(draftProblem(d)).toBe("Choose a player.");
    expect(draftProblem({ ...d, playerId: "p1" })).toBe("Give a reason.");
    expect(draftProblem({ ...d, playerId: "p1", reason: "  " })).toBe("Give a reason.");
    expect(draftProblem({ ...d, playerId: "p1", reason: "Red card", fromDate: "" })).toBe("Choose the start date.");
    expect(draftProblem({ ...d, playerId: "p1", reason: "Red card" })).toBeNull();
  });

  it("sends a trimmed new suspension, until cleared as null", () => {
    expect(newSuspension({ playerId: "p1", matches: null, fromDate: "2026-10-06", reason: " DC hearing " })).toEqual({
      playerId: "p1",
      matches: null,
      fromDate: "2026-10-06",
      reason: "DC hearing",
    });
  });

  it("sends only what an edit changed", () => {
    const s = row();
    expect(suspensionChange(s, draftFrom(s))).toBeNull();
    expect(suspensionChange(s, { ...draftFrom(s), matches: null })).toEqual({ matches: null });
    expect(suspensionChange(s, { ...draftFrom(s), reason: "Red card ", fromDate: "2026-10-02" })).toEqual({ fromDate: "2026-10-02" });
  });

  it("makes an old flag a suspension from today, asking the serving team when it has none", () => {
    const flag = { player: "p9", name: "Kim Ho", team: null, isSuspended: true, matchesToServe: 2 };
    const d = draftFromFlag(flag, "2026-10-08", ["HKFC A", "HKFC B"]);
    expect(d).toEqual({ playerId: "p9", matches: 2, fromDate: "2026-10-08", reason: FLAG_REASON, servingTeam: "" });
    expect(draftProblem(d)).toBe("Choose the serving team.");
    expect(newSuspension({ ...d, servingTeam: "HKFC B" })).toEqual({
      playerId: "p9",
      matches: 2,
      fromDate: "2026-10-08",
      reason: FLAG_REASON,
      servingTeam: "HKFC B",
    });
    expect(isDirty(d, { ...d, servingTeam: "HKFC B" })).toBe(true);
    // Suspended with nothing to serve: until cleared. A team of ours is kept; many matches fit the stepper.
    expect(draftFromFlag({ ...flag, matchesToServe: null }, "2026-10-08", []).matches).toBeNull();
    expect(draftFromFlag({ ...flag, team: "HKFC B" }, "2026-10-08", ["HKFC B"]).servingTeam).toBe("HKFC B");
    expect(draftFromFlag({ ...flag, matchesToServe: 30 }, "2026-10-08", []).matches).toBe(10);
  });

  it("knows when closing would lose something", () => {
    const start = emptyDraft("2026-10-06", "p1");
    expect(isDirty(start, start)).toBe(false);
    expect(isDirty(start, { ...start, reason: "x" })).toBe(true);
    expect(isDirty(start, { ...start, matches: 2 })).toBe(true);
  });

  it("puts Suspensions before People, for the discipline section only", () => {
    expect(officerItems({ sections: ["registration", "people", "discipline"] }).map((i) => i.to)).toEqual([
      "/registration",
      "/suspensions",
      "/people",
    ]);
    expect(officerItems({ sections: ["people"] }).map((i) => i.to)).toEqual(["/people"]);
  });
});
