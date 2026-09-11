import { describe, it, expect } from "vitest";
import { availableLabel } from "../src/lib/format";

// Before the squad is picked a player is stating availability, so the button
// says so. Once selected they are in the side, and "Going" is what they
// would say themselves. Only the wording moves - the value written is
// "Available" either way, because selection is the coach's decision and
// lives in a different field.

describe("availableLabel", () => {
  it("reads Available before the player has been selected", () => {
    expect(availableLabel(false)).toBe("Available");
  });

  it("reads Going once they are in the squad", () => {
    expect(availableLabel(true)).toBe("Going");
  });
});
