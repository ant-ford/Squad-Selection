import { describe, it, expect } from "vitest";
import { computeTeamAttendance, type TeamAttendanceInput } from "../worker/src/teamAttendance";
import type { AvailabilityRule, Match, MatchCard, Player, Team } from "../shared/schema/domainTypes";

const SEASON = "2026-2027";
const TODAY = "2026-10-01";
const RANKS = { "HKFC A": 1, "HKFC B": 2, "HKFC C": 3 };
const TEAMS: Team[] = [
  { id: "recTA", teamName: "HKFC A", teamRank: 1, targetSquadSize: 16 },
  { id: "recTB", teamName: "HKFC B", teamRank: 2, targetSquadSize: 15 },
  { id: "recTC", teamName: "HKFC C", teamRank: 3 },
];

function player(id: string, team: string, overrides: Partial<Player> = {}): Player {
  return { id, active: true, registeredTeam: team, preferredName: id, ...overrides };
}

function match(id: string, date: string, overrides: Partial<Match> = {}): Match {
  return {
    id,
    matchDate: `${date}T07:00:00.000Z`,
    season: SEASON,
    division: "2",
    competitionType: "LEAGUE",
    homeTeam: "HKFC B",
    awayTeam: "Opponent",
    homeTeamScore: 0,
    awayTeamScore: 0,
    matchStatus: date < TODAY ? "Played" : "Scheduled",
    ...overrides,
  };
}

function run(overrides: Partial<TeamAttendanceInput>) {
  return computeTeamAttendance({
    players: [],
    teams: TEAMS,
    season: SEASON,
    today: TODAY,
    teamRankMap: RANKS,
    matches: [],
    cardsByPlayer: new Map(),
    cardedMatchIds: new Set((overrides.matches ?? []).map((m) => m.id)),
    exceptions: [],
    rules: [],
    ...overrides,
  });
}

describe("computeTeamAttendance", () => {
  it("groups players by their Selected Team and orders teams by rank", () => {
    const res = run({
      players: [
        player("recC1", "HKFC C"),
        player("recB1", "HKFC C", { selectedTeamEos: "HKFC B" }),
        player("recA1", "HKFC A"),
      ],
      matches: [
        match("m1", "2026-10-04", { homeTeam: "HKFC C" }),
        match("m2", "2026-10-04"),
        match("m3", "2026-10-11", { homeTeam: "HKFC A" }),
      ],
    });
    expect(res.teams.map((t) => t.team)).toEqual(["HKFC A", "HKFC B", "HKFC C"]);
    expect(res.teams[1].players.map((p) => p.id)).toEqual(["recB1"]);
    expect(res.teams.map((t) => t.targetSquadSize)).toEqual([16, 15, 16]);
    expect(res.dates).toEqual(["2026-10-04", "2026-10-11"]);
  });

  it("names players by first name and surname", () => {
    const res = run({
      players: [player("recB1", "HKFC B", { preferredName: "Matt", surname: "Lowe" }), player("recB2", "HKFC B", { preferredName: "", givenNames: "Matthew", surname: "Archer" })],
      matches: [match("m1", "2026-10-04")],
    });
    expect(res.teams[0].players.map((p) => p.name)).toEqual(["Matt Lowe", "Matthew Archer"]);
  });

  it("leaves out teams with no squad, and a squad's other teams' fixtures", () => {
    const res = run({
      players: [player("recB1", "HKFC B")],
      matches: [match("m1", "2026-10-04"), match("m2", "2026-10-11", { homeTeam: "HKFC A" })],
    });
    expect(res.teams.map((t) => t.team)).toEqual(["HKFC B"]);
    expect(res.fixtures.map((f) => f.matchId)).toEqual(["m1"]);
    expect(res.dates).toEqual(["2026-10-04"]);
    expect(Object.keys(res.teams[0].players[0].cells)).toEqual(["m1"]);
  });

  it("resolves each player's status as their own attendance grid does", () => {
    const rules: AvailabilityRule[] = [{
      id: "recR1", player: ["recB3"], ruleType: "All future", availability: "Unavailable", active: true,
      startDate: "", endDate: "", notes: "", lastModified: "2026-09-01T00:00:00Z",
    }];
    const res = run({
      players: [
        player("recB1", "HKFC B"),
        player("recB2", "HKFC B"),
        player("recB3", "HKFC B"),
        player("recB4", "HKFC B", { optInOnly: true }),
        player("recB5", "HKFC B"),
        player("recB6", "HKFC B"),
      ],
      matches: [
        match("m1", "2026-10-04", { selectedPlayersHome: ["recB5"] }),
        match("mA", "2026-10-04", { homeTeam: "HKFC A", selectedPlayersHome: ["recB6"] }),
      ],
      exceptions: [{ player: ["recB2"], match: ["m1"], availabilityStatus: "Maybe" }],
      rules,
    });
    const cells = Object.fromEntries(res.teams[0].players.map((p) => [p.id, p.cells.m1]));
    expect(cells.recB1).toEqual({ status: "available", source: "default" });
    expect(cells.recB2).toEqual({ status: "maybe", source: "answer" });
    expect(cells.recB3).toEqual({ status: "unavailable", source: "rule" });
    expect(cells.recB4).toEqual({ status: "unavailable", source: "opt-in" });
    expect(cells.recB5).toEqual({ status: "selected", source: "default" });
    expect(cells.recB6).toEqual({ status: "elsewhere", source: "default", elsewhereTeam: "HKFC A" });
    expect(res.fixtures.find((f) => f.matchId === "m1")?.selectedCount).toBe(1);
  });

  it("records the result and off fixtures from the team's side", () => {
    const cards: MatchCard[] = [{ id: "c1", player: ["recB1"], match: ["m1"], team: "HKFC B", season: SEASON, goals: 1 }];
    const res = run({
      players: [player("recB1", "HKFC B")],
      matches: [
        match("m1", "2026-09-20", { homeTeam: "Opponent", awayTeam: "HKFC B", homeTeamScore: 1, awayTeamScore: 3 }),
        match("m2", "2026-10-04", { matchStatus: "Cancelled" }),
      ],
      cardsByPlayer: new Map([["recB1", cards]]),
    });
    const [played, off] = res.fixtures;
    expect(played).toMatchObject({ past: true, isHome: false, goalsFor: 3, goalsAgainst: 1, off: false });
    expect(off).toMatchObject({ past: false, off: true });
    expect(res.teams[0].players[0].cells.m1.status).toBe("played");
  });
});
