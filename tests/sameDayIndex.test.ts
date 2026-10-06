import { describe, it, expect } from "vitest";
import { hkDateKey } from "../shared/hkDateKey";
import { getSameDayMatches } from "../worker/src/seasonContext";
import type { Match } from "../shared/schema/domainTypes";

// ---------------------------------------------------------------------------
// getSameDayMatches is now a lookup in a per-array day index instead of a
// scan of the whole season per call. The answers must not change: same
// matches, same order, for every date the app asks about.
// ---------------------------------------------------------------------------

// Memoised only so the reference stays quick where hkDateKey is slow: the
// same string always gives the same key, so the answers are unchanged.
const keyCache = new Map<string, string>();
function refKey(iso: string | null | undefined): string {
  const k = String(iso);
  let v = keyCache.get(k);
  if (v === undefined) keyCache.set(k, (v = hkDateKey(iso)));
  return v;
}

/** The scan getSameDayMatches used to do, kept here as the reference. */
function scanSameDay(allMatches: Match[], targetDate: string): Match[] {
  const target = refKey(targetDate);
  return allMatches.filter((m) => refKey(m.matchDate) === target);
}

const TEAMS = ["HKFC A", "HKFC B", "HKFC C", "HKFC D", "HKFC E", "HKFC F", "HKFC G", "HKFC H"];
// HKT kick-off hours, including an 08:00 HKT start (00:00 UTC) and a
// 03:00 HKT one (19:00 UTC the previous day).
const KICKOFF_HKT = [3, 8, 9, 10.5, 12, 13.5, 15, 16.5, 18, 19.5, 21];

/** Deterministic pseudo-random (no flaky seeds). */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

/** A season shaped like the real one: ~250 matches over weekends Sep-Apr, plus midweek games and a few bad dates. */
function fakeSeason(): Match[] {
  const rand = rng(2026);
  const out: Match[] = [];
  let n = 0;
  const start = Date.UTC(2026, 8, 5); // Saturday 5 Sep 2026
  for (let week = 0; week < 32; week++) {
    for (const dayOffset of [0, 1, 3]) {
      if (dayOffset === 3 && rand() < 0.6) continue; // midweek only some weeks
      const games = dayOffset === 3 ? 1 : 3 + Math.floor(rand() * 2);
      for (let g = 0; g < games; g++) {
        const hour = KICKOFF_HKT[Math.floor(rand() * KICKOFF_HKT.length)];
        const ms = start + (week * 7 + dayOffset) * 86_400_000 + (hour - 8) * 3_600_000;
        const home = rand() < 0.5;
        const team = TEAMS[Math.floor(rand() * TEAMS.length)];
        out.push({
          id: `m${++n}`,
          matchDate: new Date(ms).toISOString(),
          season: "2026-2027",
          homeTeam: home ? team : "Opponent",
          awayTeam: home ? "Opponent" : team,
          homeTeamScore: 0,
          awayTeamScore: 0,
          division: "Division 2",
          competitionType: "League",
          matchStatus: "Scheduled",
        });
      }
    }
  }
  // Records with no usable date: these group under "" in both versions.
  out.splice(17, 0, { ...out[0], id: "no-date", matchDate: "" });
  out.splice(90, 0, { ...out[0], id: "bad-date", matchDate: "not-a-date" });
  out.splice(140, 0, { ...out[0], id: "null-date", matchDate: null as unknown as string });
  return out;
}

const ids = (ms: Match[]) => ms.map((m) => m.id);

describe("getSameDayMatches day index", () => {
  const season = fakeSeason();

  it("builds a season of realistic size", () => {
    expect(season.length).toBeGreaterThan(200);
    expect(season.length).toBeLessThan(320);
  });

  it("matches the old scan for every match's own date", () => {
    for (const m of season) {
      expect(ids(getSameDayMatches(season, m.matchDate))).toEqual(ids(scanSameDay(season, m.matchDate)));
    }
  });

  it("matches the old scan for dates with no fixtures, day boundaries, and empty/invalid input", () => {
    const probes = [
      "2026-09-04T16:00:00.000Z", // 00:00 HKT 5 Sep
      "2026-09-05T15:59:59.999Z", // 23:59 HKT 5 Sep
      "2026-09-05T16:00:00.000Z", // 00:00 HKT 6 Sep
      "2026-12-25T04:00:00.000Z",
      "2027-06-30T04:00:00.000Z", // after the season
      "",
      "not-a-date",
    ];
    for (const date of probes) {
      expect(ids(getSameDayMatches(season, date))).toEqual(ids(scanSameDay(season, date)));
    }
  });

  it("returns the same Match objects, not copies", () => {
    const date = season[5].matchDate;
    const fresh = getSameDayMatches(season, date);
    const old = scanSameDay(season, date);
    fresh.forEach((m, i) => expect(m).toBe(old[i]));
  });

  it("hands back a fresh array, so a caller changing it cannot corrupt the index", () => {
    const date = season[5].matchDate;
    const first = getSameDayMatches(season, date);
    expect(first.length).toBeGreaterThan(0);
    first.length = 0;
    expect(ids(getSameDayMatches(season, date))).toEqual(ids(scanSameDay(season, date)));
  });

  it("rebuilds when the array grows", () => {
    const local = fakeSeason();
    const date = local[0].matchDate;
    getSameDayMatches(local, date); // index built
    local.push({ ...local[0], id: "late-addition" });
    expect(ids(getSameDayMatches(local, date))).toEqual(ids(scanSameDay(local, date)));
    expect(ids(getSameDayMatches(local, date))).toContain("late-addition");
  });

  it("keeps separate arrays separate", () => {
    const other = [season[0]];
    expect(ids(getSameDayMatches(other, season[0].matchDate))).toEqual([season[0].id]);
    expect(getSameDayMatches(season, season[0].matchDate).length).toBeGreaterThanOrEqual(1);
  });
});
