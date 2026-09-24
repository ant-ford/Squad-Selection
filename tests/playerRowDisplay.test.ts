import { describe, it, expect } from "vitest";
import {
  displayWarning,
  conflictsWorthShowing,
  warningsWorthShowing,
  playUpTone,
  canToggleSelection,
} from "../src/components/PlayerRow";

// The coach's player row is decluttered at the point of display. The
// engine's strings are deliberately NOT changed - the golden tests pin them,
// and invariant 2 says reason strings are added to, never reworded.

describe("player row: what it leaves out (owner request, 2026-09-23)", () => {
  it("does not say a player is available for the teams above", () => {
    expect(warningsWorthShowing(["Available for HKFC B, HKFC C on same day"])).toEqual([]);
  });

  it("does not show play-up warnings; the count is coloured instead", () => {
    expect(
      warningsWorthShowing([
        "Second play-up appearance",
        "Third play-up appearance",
        "Seventh play-up appearance (U21 limit 8)",
      ]),
    ).toEqual([]);
  });

  it("keeps every other warning", () => {
    expect(warningsWorthShowing(["Visiting player early-season requirement at risk"])).toEqual([
      "Visiting player early-season requirement at risk",
    ]);
    expect(warningsWorthShowing(undefined)).toEqual([]);
  });

  it("shows only Selected chips, never Available ones", () => {
    const out = conflictsWorthShowing([
      { type: "selected", team: "HKFC B" },
      { type: "available", team: "HKFC C" },
    ]);
    expect(out).toEqual([{ type: "selected", team: "HKFC B" }]);
    expect(conflictsWorthShowing(undefined)).toEqual([]);
  });

  it("drops the club prefix a coach can take as read", () => {
    expect(displayWarning("Already played in a Cup for HKFC D this season")).toBe(
      "Already played in a Cup for D this season",
    );
    expect(displayWarning("Suspended")).toBe("Suspended");
  });
});

describe("player row: play-up count colour", () => {
  it("is amber at 2 and red from 3 for most players", () => {
    expect(playUpTone(0, false)).toBe("none");
    expect(playUpTone(1, false)).toBe("none");
    expect(playUpTone(2, false)).toBe("amber");
    expect(playUpTone(3, false)).toBe("red");
    expect(playUpTone(4, false)).toBe("red");
  });

  it("is amber at 7 and red from 8 for a U21 (allowance 8, Bye-law 7.2(b))", () => {
    expect(playUpTone(2, true)).toBe("none");
    expect(playUpTone(6, true)).toBe("none");
    expect(playUpTone(7, true)).toBe("amber");
    expect(playUpTone(8, true)).toBe("red");
  });
});

// A player picked for the Es can afterwards be taken by the Cs. That blocks
// them for the E fixture, and the E coach was then stuck: the row would not
// respond, so the selection could not be taken off their own sheet.
describe("player row: blocked never strands an existing selection", () => {
  it("lets a blocked player who is already selected be taken back off", () => {
    expect(canToggleSelection(true, true)).toBe(true);
  });

  it("still refuses to pick a blocked player who is not selected", () => {
    expect(canToggleSelection(true, false)).toBe(false);
  });

  it("leaves unblocked rows toggling either way", () => {
    expect(canToggleSelection(false, false)).toBe(true);
    expect(canToggleSelection(false, true)).toBe(true);
  });
});
