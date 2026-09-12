import { describe, it, expect } from "vitest";
import { displayWarning, conflictsWorthShowing } from "../src/components/PlayerRow";

// The coach's player row showed the same fact twice: one "Available: X" chip
// per team, then a sentence naming all of them. These are the two pure
// helpers behind the de-duplication, kept here so the rule is pinned even
// though the row itself is JSX.
//
// The engine's warning string is deliberately NOT changed - the golden tests
// pin it, and invariant 2 says reason strings are added to, never reworded.

describe("player row: same-day availability shown once", () => {
  const warning = "Available for HKFC B, HKFC C on same day";

  it("trims the suffix and the club prefix a coach can take as read", () => {
    expect(displayWarning(warning)).toBe("Available for B, C");
  });

  it("drops the club prefix even where there is no suffix to trim", () => {
    expect(displayWarning("Selected for HKFC A on same day")).toBe("Selected for A");
    expect(displayWarning("Already played in a Cup for HKFC D this season")).toBe(
      "Already played in a Cup for D this season",
    );
  });

  it("leaves every other warning exactly as the engine wrote it", () => {
    expect(displayWarning("Play-up limit reached")).toBe("Play-up limit reached");
    expect(displayWarning("Suspended")).toBe("Suspended");
  });

  it("drops the availability chips the warning already names", () => {
    const out = conflictsWorthShowing(
      [
        { type: "available", team: "HKFC B" },
        { type: "available", team: "HKFC C" },
      ],
      [warning],
    );
    expect(out).toEqual([]);
  });

  // Being picked elsewhere is a different fact from merely being free, and
  // it is the one a coach must not miss.
  it("keeps Selected chips even when the same team is in the warning", () => {
    const out = conflictsWorthShowing(
      [
        { type: "selected", team: "HKFC B" },
        { type: "available", team: "HKFC C" },
      ],
      [warning],
    );
    expect(out).toEqual([{ type: "selected", team: "HKFC B" }]);
  });

  it("keeps an availability chip the warning does not mention", () => {
    const out = conflictsWorthShowing([{ type: "available", team: "HKFC A" }], [warning]);
    expect(out).toEqual([{ type: "available", team: "HKFC A" }]);
  });

  it("keeps every chip when there is no same-day warning at all", () => {
    const conflicts = [{ type: "available", team: "HKFC C" }];
    expect(conflictsWorthShowing(conflicts, [])).toEqual(conflicts);
    expect(conflictsWorthShowing(conflicts, undefined)).toEqual(conflicts);
  });
});
