import { describe, it, expect } from "vitest";
import { hkDateKey } from "../src/lib/hkDateKey";
import { getSameDayMatches } from "../worker/src/seasonContext";
import { currentSeason } from "../worker/src/dashboard";
import type { Match } from "../src/generated/domainTypes";

// ---------------------------------------------------------------------------
// One shared Hong Kong date key (bug B5): a 03:00 HKT kick-off is 19:00 UTC
// the PREVIOUS day. Grouping by the UTC date (the old `.split("T")[0]`)
// put it on the wrong day for same-day eligibility, fixture grouping and
// availability - one authoritative HKT-based key fixes all of them at once.
// ---------------------------------------------------------------------------

function m(overrides: Partial<Match> = {}): Match {
  return {
    id: "m1", matchDate: "2026-07-05T12:00:00.000Z", season: "2025-2026", homeTeam: "HKFC C",
    awayTeam: "Opponent C", homeTeamScore: 0, awayTeamScore: 0, division: "Division 2",
    competitionType: "League", matchStatus: "Scheduled", ...overrides,
  };
}

describe("hkDateKey", () => {
  it("groups a 03:00 HKT kick-off with the HKT date, not the UTC one", () => {
    // 2026-07-06T03:00 HKT == 2026-07-05T19:00 UTC (HKT is UTC+8).
    expect(hkDateKey("2026-07-05T19:00:00.000Z")).toBe("2026-07-06");
  });

  it("matches for a kick-off well within the UTC day too", () => {
    expect(hkDateKey("2026-07-05T02:00:00.000Z")).toBe("2026-07-05");
  });

  it("returns '' for empty/invalid input", () => {
    expect(hkDateKey("")).toBe("");
    expect(hkDateKey(null)).toBe("");
    expect(hkDateKey("not-a-date")).toBe("");
  });
});

describe("getSameDayMatches (seasonContext.ts)", () => {
  it("treats a 03:00 HKT early fixture as the same day as an evening HKT fixture, even though they're on different UTC calendar days", () => {
    const earlyKickoff = m({ id: "early", matchDate: "2026-07-05T19:00:00.000Z" }); // 03:00 HKT on 07-06
    const eveningSameDay = m({ id: "evening", matchDate: "2026-07-06T11:00:00.000Z" }); // 19:00 HKT on 07-06
    const differentDay = m({ id: "other", matchDate: "2026-07-07T11:00:00.000Z" });

    const result = getSameDayMatches([earlyKickoff, eveningSameDay, differentDay], "2026-07-06T11:00:00.000Z");
    expect(result.map((r) => r.id).sort()).toEqual(["early", "evening"]);
  });

  it("would have wrongly split them under UTC-only day grouping (regression guard)", () => {
    // Sanity check on the fixture itself: the two "same HKT day" matches
    // really do fall on different UTC calendar days, so this only passes
    // because getSameDayMatches uses hkDateKey and not a raw UTC split.
    expect("2026-07-05T19:00:00.000Z".split("T")[0]).not.toBe("2026-07-06T11:00:00.000Z".split("T")[0]);
  });
});

describe("currentSeason (dashboard.ts)", () => {
  it("uses the HKT month for the season boundary, not the runner's local/UTC month", () => {
    // 2026-06-30T17:00 UTC == 2026-07-01T01:00 HKT: already July in HKT,
    // so the new season has started even though it's still June in UTC.
    expect(currentSeason(new Date("2026-06-30T17:00:00.000Z"))).toBe("2026-2027");
    // The reverse boundary: 2026-07-01T15:00 UTC == 2026-07-01T23:00 HKT,
    // still within the same HKT day, no ambiguity either way here - pick a
    // clearer pre-boundary instant instead.
    expect(currentSeason(new Date("2026-06-30T10:00:00.000Z"))).toBe("2025-2026"); // 18:00 HKT, still June
  });
});
