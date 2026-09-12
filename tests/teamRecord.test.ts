import { describe, it, expect } from "vitest";
import { buildTeamRecord, outcomeOf } from "../worker/src/teamRecord";
import type { Match } from "../shared/schema/domainTypes";

// A coach opening a squad screen wants two things they cannot get from the
// fixture row: how the season is going, and how the last one against these
// opponents went. Both are read off completed matches only.

const SEASON = "2026-2027";

function played(over: Partial<Match> & { homeTeam: string; awayTeam: string }): Match {
  return {
    id: `rec${Math.random().toString(36).slice(2, 8)}`,
    matchDate: "2026-10-01T09:00:00.000Z",
    season: SEASON,
    division: "Prem",
    competitionType: "LEAGUE",
    homeTeamScore: 0,
    awayTeamScore: 0,
    matchStatus: "Played",
    venue: "HKFC",
    ...over,
  } as Match;
}

describe("outcomeOf", () => {
  it("reads the scoreline from the named team's side", () => {
    expect(outcomeOf(3, 1)).toBe("win");
    expect(outcomeOf(1, 1)).toBe("draw");
    expect(outcomeOf(0, 2)).toBe("loss");
  });
});

describe("season record", () => {
  it("counts a team's wins, draws and losses on both sides of the fixture", () => {
    const record = buildTeamRecord(
      [
        played({ homeTeam: "HKFC C", awayTeam: "KCC", homeTeamScore: 3, awayTeamScore: 1 }), // W
        played({ homeTeam: "Recreio", awayTeam: "HKFC C", homeTeamScore: 0, awayTeamScore: 2 }), // W away
        played({ homeTeam: "HKFC C", awayTeam: "LF", homeTeamScore: 1, awayTeamScore: 1 }), // D
        played({ homeTeam: "KP", awayTeam: "HKFC C", homeTeamScore: 4, awayTeamScore: 0 }), // L away
      ],
      "HKFC C",
      undefined,
      SEASON,
    );
    expect(record).toMatchObject({ played: 4, won: 2, drawn: 1, lost: 1 });
  });

  it("ignores other teams' matches and other seasons", () => {
    const record = buildTeamRecord(
      [
        played({ homeTeam: "HKFC B", awayTeam: "KCC", homeTeamScore: 5, awayTeamScore: 0 }),
        played({ homeTeam: "HKFC C", awayTeam: "KCC", homeTeamScore: 5, awayTeamScore: 0, season: "2025-2026" }),
      ],
      "HKFC C",
      undefined,
      SEASON,
    );
    expect(record).toMatchObject({ played: 0, won: 0, drawn: 0, lost: 0 });
  });

  // A warm-up game is not part of the season's story.
  it("leaves friendlies out of the record", () => {
    const record = buildTeamRecord(
      [
        played({ homeTeam: "HKFC C", awayTeam: "KCC", homeTeamScore: 6, awayTeamScore: 0, competitionType: "FRIENDLY" }),
        played({ homeTeam: "HKFC C", awayTeam: "LF", homeTeamScore: 2, awayTeamScore: 0 }),
      ],
      "HKFC C",
      undefined,
      SEASON,
    );
    expect(record).toMatchObject({ played: 1, won: 1 });
  });
});

describe("last meeting", () => {
  it("finds the most recent completed meeting with this opponent", () => {
    const record = buildTeamRecord(
      [
        played({ homeTeam: "HKFC C", awayTeam: "KCC", homeTeamScore: 1, awayTeamScore: 0, matchDate: "2026-09-01T09:00:00.000Z" }),
        played({ homeTeam: "KCC", awayTeam: "HKFC C", homeTeamScore: 4, awayTeamScore: 2, matchDate: "2026-11-20T09:00:00.000Z" }),
        played({ homeTeam: "HKFC C", awayTeam: "LF", homeTeamScore: 9, awayTeamScore: 0, matchDate: "2026-12-01T09:00:00.000Z" }),
      ],
      "HKFC C",
      "KCC",
      SEASON,
    );
    expect(record.lastMeeting).toMatchObject({
      outcome: "loss",
      goalsFor: 2,
      goalsAgainst: 4,
      isHome: false,
      venue: "HKFC",
      date: "2026-11-20T09:00:00.000Z",
    });
  });

  // For an opponent met twice a year, the useful answer is often last season's.
  it("reaches back past this season for a meeting", () => {
    const record = buildTeamRecord(
      [played({ homeTeam: "HKFC C", awayTeam: "KCC", homeTeamScore: 2, awayTeamScore: 1, season: "2025-2026", matchDate: "2026-03-08T09:00:00.000Z" })],
      "HKFC C",
      "KCC",
      SEASON,
    );
    expect(record.played).toBe(0);
    expect(record.lastMeeting).toMatchObject({ outcome: "win", season: "2025-2026" });
  });

  it("is null when these two have not met, or when no opponent is asked about", () => {
    const matches = [played({ homeTeam: "HKFC C", awayTeam: "LF", homeTeamScore: 1, awayTeamScore: 0 })];
    expect(buildTeamRecord(matches, "HKFC C", "KCC", SEASON).lastMeeting).toBeNull();
    expect(buildTeamRecord(matches, "HKFC C", undefined, SEASON).lastMeeting).toBeNull();
  });
});
