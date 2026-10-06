import { describe, it, expect } from "vitest";
import {
  otherGamesThatDay,
  needsSameDayPrompt,
  groupByHkDay,
  multiFixtureDays,
  firstCardOfEachDay,
  commonDayAnswer,
} from "../src/lib/sameDayGames";
import type { MyFixture } from "../src/api/getMyFixtures";

// ---------------------------------------------------------------------------
// Same-day prompt on the player dashboard: a player who says "No" to their
// own team's game is asked about the other games they still read as
// Available for that day (opt-out leaves them Available unless they answer).
// ---------------------------------------------------------------------------

const fx = (id: string, date: string, status: string, category: MyFixture["fixtureCategory"] = "own") =>
  ({ id, date, availabilityStatus: status, fixtureCategory: category }) as MyFixture;

describe("otherGamesThatDay", () => {
  it("returns the other fixtures on the same Hong Kong day, in kick-off order", () => {
    const own = fx("m1", "2026-10-04T06:00:00.000Z", "Unavailable");
    const all = [
      own,
      fx("m3", "2026-10-04T09:00:00.000Z", "Available", "support"),
      fx("m2", "2026-10-04T01:30:00.000Z", "Maybe", "play-up"),
      fx("m4", "2026-10-05T06:00:00.000Z", "Available", "play-up"),
    ];
    expect(otherGamesThatDay(own, all).map((f) => f.id)).toEqual(["m2", "m3"]);
  });

  it("groups by the Hong Kong day, not the UTC one", () => {
    // 17:00 UTC on the 3rd is 01:00 HKT on the 4th.
    const own = fx("m1", "2026-10-04T06:00:00.000Z", "Unavailable");
    const late = fx("m2", "2026-10-03T17:00:00.000Z", "Available", "support");
    expect(otherGamesThatDay(own, [own, late]).map((f) => f.id)).toEqual(["m2"]);
  });

  it("lists a fixture once even if it appears in two lists", () => {
    const own = fx("m1", "2026-10-04T06:00:00.000Z", "Unavailable");
    const other = fx("m2", "2026-10-04T08:00:00.000Z", "Available", "play-up");
    expect(otherGamesThatDay(own, [own, other, other])).toHaveLength(1);
  });
});

describe("needsSameDayPrompt", () => {
  const own = fx("m1", "2026-10-04T06:00:00.000Z", "Unavailable");

  it("asks when out for this game but still in for another", () => {
    expect(needsSameDayPrompt(own, [fx("m2", own.date, "Available", "support")])).toBe(true);
    expect(needsSameDayPrompt(own, [fx("m2", own.date, "Maybe", "play-up")])).toBe(true);
  });

  it("does not ask once every other game is answered No", () => {
    expect(needsSameDayPrompt(own, [fx("m2", own.date, "Unavailable", "support")])).toBe(false);
  });

  it("does not ask when the player is in for this game, or there is no other game", () => {
    expect(needsSameDayPrompt({ ...own, availabilityStatus: "Maybe" }, [fx("m2", own.date, "Available")])).toBe(false);
    expect(needsSameDayPrompt(own, [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Whole-day control: one "All available / All maybe / All no" per day that
// has more than one fixture, in front of that day's first card on the page.
// ---------------------------------------------------------------------------

describe("multiFixtureDays", () => {
  it("keeps only days with two or more different fixtures", () => {
    const sat1 = fx("m1", "2026-10-03T06:00:00.000Z", "Available");
    const sat1b = fx("m2", "2026-10-03T09:00:00.000Z", "Available", "support");
    const sat2 = fx("m3", "2026-10-10T06:00:00.000Z", "Available");
    const days = multiFixtureDays(groupByHkDay([sat1, sat1b, sat2]));
    expect([...days.keys()]).toEqual(["2026-10-03"]);
  });

  it("does not count one fixture listed twice as two", () => {
    const own = fx("m1", "2026-10-03T06:00:00.000Z", "Available");
    expect(multiFixtureDays(groupByHkDay([own, { ...own }])).size).toBe(0);
    const other = fx("m2", "2026-10-03T09:00:00.000Z", "Available", "support");
    expect(multiFixtureDays(groupByHkDay([own, other, { ...own }])).get("2026-10-03")).toHaveLength(2);
  });
});

describe("firstCardOfEachDay", () => {
  it("picks the first shown card of each multi-fixture day", () => {
    const own = fx("m1", "2026-10-03T06:00:00.000Z", "Available");
    const playUp = fx("m2", "2026-10-03T02:00:00.000Z", "Available", "play-up");
    const lone = fx("m3", "2026-10-10T06:00:00.000Z", "Available");
    const days = multiFixtureDays(groupByHkDay([own, playUp, lone]));
    // My Team is shown before play-ups, so the control sits above the own game.
    expect([...firstCardOfEachDay([own, lone, playUp], days)]).toEqual([own]);
  });

  it("puts the control on a play-up card when the day has no My Team game", () => {
    const playUp = fx("m2", "2026-10-04T02:00:00.000Z", "Available", "play-up");
    const support = fx("m4", "2026-10-04T08:00:00.000Z", "Maybe", "support");
    const days = multiFixtureDays(groupByHkDay([playUp, support]));
    expect([...firstCardOfEachDay([playUp, support], days)]).toEqual([playUp]);
    // Both lists collapsed: nothing shown, no control.
    expect(firstCardOfEachDay([], days).size).toBe(0);
  });
});

describe("commonDayAnswer", () => {
  it("returns the shared answer, or null when the day is mixed", () => {
    const a = fx("m1", "2026-10-03T06:00:00.000Z", "Unavailable");
    const b = fx("m2", "2026-10-03T09:00:00.000Z", "Unavailable", "support");
    const c = fx("m3", "2026-10-03T10:00:00.000Z", "Maybe", "play-up");
    expect(commonDayAnswer([a, b])).toBe("Unavailable");
    expect(commonDayAnswer([a, b, c])).toBeNull();
    expect(commonDayAnswer([])).toBeNull();
  });
});
