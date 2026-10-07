import { describe, it, expect } from "vitest";
import { addDays, daysBetween, hkDateKey } from "../shared/hkDateKey";
import { getSameDayMatches } from "../worker/src/seasonContext";
import { currentSeason } from "../worker/src/seasonContext";
import type { Match } from "../shared/schema/domainTypes";

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

describe("currentSeason (seasonContext.ts)", () => {
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

// Day-key arithmetic: one copy for the worker, the shared insights and the
// test fakes (S8). Plain date arithmetic on the key, never shifted by a zone.
describe("addDays", () => {
  it("crosses month, year and leap-day boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-10-07", 0)).toBe("2026-10-07");
    expect(addDays("2026-10-07", -364)).toBe("2025-10-08");
  });

  it("gives the same day as the setUTCDate copy it replaced", () => {
    const viaSetDate = (day: string, n: number) => {
      const d = new Date(`${day}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };
    for (let i = 0; i < 800; i += 7) {
      const day = addDays("2025-01-01", i);
      for (const n of [-729, -365, -364, -2, -1, 1, 2, 6, 14, 365]) expect(addDays(day, n)).toBe(viaSetDate(day, n));
    }
  });

  it("throws on a day that is not a date, as every copy did", () => {
    expect(() => addDays("not a day", 1)).toThrow(RangeError);
  });
});

describe("daysBetween", () => {
  it("counts whole days, negative when the second day is earlier", () => {
    expect(daysBetween("2026-10-01", "2026-10-07")).toBe(6);
    expect(daysBetween("2026-10-07", "2026-10-01")).toBe(-6);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
    expect(daysBetween("2026-10-07", "2026-10-07")).toBe(0);
  });

  it("undoes addDays", () => {
    for (const n of [-400, -1, 0, 1, 30, 366]) expect(daysBetween("2026-10-07", addDays("2026-10-07", n))).toBe(n);
  });
});
