import { describe, it, expect } from "vitest";
import { ANSWERS, answerOptions, dayAnswerOptions, preferenceTagLabel } from "../src/lib/availabilityAnswers";

// The segmented control on a fixture card and in the coach's sheet.

describe("answerOptions", () => {
  it("offers Available / Maybe / No, storing Unavailable for No", () => {
    expect(answerOptions("Available").map((o) => [o.value, o.label])).toEqual([
      ["Available", "Available"],
      ["Maybe", "Maybe"],
      ["Unavailable", "No"],
    ]);
    expect(ANSWERS).toEqual(["Available", "Maybe", "Unavailable"]);
  });

  it('says "Going" instead of Available once the player is in the squad', () => {
    expect(answerOptions("Available", true).map((o) => o.label)).toEqual(["Going", "Maybe", "No"]);
  });

  it("presses exactly the current answer", () => {
    for (const current of ANSWERS) {
      const pressed = answerOptions(current).filter((o) => o.pressed);
      expect(pressed.map((o) => o.value)).toEqual([current]);
    }
  });

  it("presses nothing for a missing or unknown status", () => {
    for (const current of ["", null, undefined, "Pending"]) {
      expect(answerOptions(current).some((o) => o.pressed)).toBe(false);
    }
  });
});

describe("dayAnswerOptions", () => {
  it('reads "All available / All maybe / All no"', () => {
    expect(dayAnswerOptions(null).map((o) => o.label)).toEqual(["All available", "All maybe", "All no"]);
    expect(dayAnswerOptions(null).some((o) => o.pressed)).toBe(false);
  });

  it("presses the answer the whole day already shares", () => {
    expect(dayAnswerOptions("Unavailable").filter((o) => o.pressed).map((o) => o.value)).toEqual(["Unavailable"]);
  });
});

describe("preferenceTagLabel", () => {
  it("explains the pref. tag to the player and to a coach", () => {
    expect(preferenceTagLabel("your")).toMatch(/your availability preferences/);
    expect(preferenceTagLabel("their")).toMatch(/their availability preferences/);
  });
});
