import { describe, it, expect } from "vitest";
import { otherGamesThatDay, needsSameDayPrompt } from "../src/lib/sameDayGames";
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
