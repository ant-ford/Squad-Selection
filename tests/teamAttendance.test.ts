import { describe, it, expect } from "vitest";
import { computeTeamAttendance, onlyTeams, type TeamAttendanceInput } from "../worker/src/teamAttendance";
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

  // Coaches see only their own squads (owner decision, 7 Oct 2026); those
  // who coach every team are handed every name.
  it("narrows to the coach's teams: their squads, fixtures and dates only", () => {
    const res = onlyTeams(run({
      players: [player("recA1", "HKFC A"), player("recB1", "HKFC B"), player("recC1", "HKFC C")],
      matches: [
        match("m1", "2026-10-04", { homeTeam: "HKFC B", awayTeam: "HKFC C" }),
        match("m2", "2026-10-11", { homeTeam: "HKFC A" }),
        match("m3", "2026-10-18"),
      ],
    }), ["HKFC B"]);
    expect(res.teams.map((t) => t.team)).toEqual(["HKFC B"]);
    expect(res.fixtures.map((f) => [f.matchId, f.team])).toEqual([["m1", "HKFC B"], ["m3", "HKFC B"]]);
    expect(res.dates).toEqual(["2026-10-04", "2026-10-18"]);
    expect(onlyTeams(res, []).teams).toEqual([]);
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

  it("counts everyone on each side's Match Card, from any squad, once each", () => {
    const card = (id: string, player: string, matchId: string, team: string): MatchCard =>
      ({ id, player: [player], match: [matchId], team, season: SEASON, goals: 0 });
    const res = run({
      players: [player("recB1", "HKFC B"), player("recC1", "HKFC C")],
      matches: [match("d1", "2026-09-20", { homeTeam: "HKFC B", awayTeam: "HKFC C" })],
      cardsByPlayer: new Map([
        ["recB1", [card("c1", "recB1", "d1", "HKFC B"), card("c1b", "recB1", "d1", "HKFC B")]],
        ["recC1", [card("c2", "recC1", "d1", "HKFC B")]],
        ["recX", [card("c3", "recX", "d1", "HKFC C")]],
      ]),
    });
    const count = (team: string) => res.fixtures.find((f) => f.team === team)?.cardCount;
    expect(count("HKFC B")).toBe(2);
    expect(count("HKFC C")).toBe(1);
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
    expect(played).toMatchObject({ past: true, isHome: false, goalsFor: 3, goalsAgainst: 1, off: false, cardCount: 1 });
    expect(off).toMatchObject({ past: false, off: true });
    expect(off.cardCount).toBeUndefined();
    expect(res.teams[0].players[0].cells.m1.status).toBe("played");
  });

  it("shows only selected players from other displayed squads on the correct upcoming derby side", () => {
    const res = run({
      players: [
        player("recB1", "HKFC B"),
        player("recMoved", "HKFC C", { selectedTeamEos: "HKFC B" }),
        player("recC1", "HKFC C", { preferredName: "Chris", surname: "Lee", email: "private@example.com", mobileNo: "private-mobile" }),
        player("recC2", "HKFC C"),
        player("recA1", "HKFC A"),
      ],
      matches: [match("derby", "2026-10-04", {
        awayTeam: "HKFC C", selectedPlayersHome: ["recB1", "recMoved", "recC1", "recC1"],
        selectedPlayersAway: ["recC2", "recA1"],
      })],
    });
    const home = res.fixtures.find((f) => f.team === "HKFC B")!;
    const away = res.fixtures.find((f) => f.team === "HKFC C")!;
    expect(home.selectedCount).toBe(3);
    expect(home.otherPlayers).toEqual([{ id: "recC1", name: "Chris Lee", team: "HKFC C" }]);
    expect(away.otherPlayers).toEqual([{ id: "recA1", name: "recA1", team: "HKFC A" }]);
    expect(JSON.stringify(home.otherPlayers)).not.toContain("private");
    const scoped = onlyTeams(res, ["HKFC B"]);
    expect(scoped.fixtures).toHaveLength(1);
    expect(scoped.fixtures[0].otherPlayers).toEqual(home.otherPlayers);
    expect(scoped.teams.map((t) => t.team)).toEqual(["HKFC B"]);
  });

  it("uses actual match cards for past guests, excluding no-shows and other matches or seasons", () => {
    const card = (id: string, who: string, matchId: string, team: string, season = SEASON): MatchCard =>
      ({ id, player: [who], match: [matchId], team, season });
    const res = run({
      players: [player("recB1", "HKFC B"), player("recC1", "HKFC C"), player("recNoShow", "HKFC C")],
      matches: [
        match("past", "2026-09-20", { selectedPlayersHome: ["recC1", "recNoShow"] }),
        match("elsewhere", "2026-09-20", { homeTeam: "HKFC A" }),
      ],
      cardsByPlayer: new Map([
        ["recC1", [card("c1", "recC1", "past", "HKFC B"), card("c2", "recC1", "past", "HKFC B")]],
        ["recNoShow", [card("c3", "recNoShow", "elsewhere", "HKFC A"), card("c4", "recNoShow", "past", "HKFC B", "2025-2026")]],
      ]),
    });
    expect(res.fixtures.find((f) => f.matchId === "past")).toMatchObject({
      cardCount: 1, otherPlayers: [{ id: "recC1", name: "recC1", team: "HKFC C" }],
    });
  });

  it("keeps historical guests whose names and teams are recorded only on their match card", () => {
    const res = run({
      players: [player("recB1", "HKFC B")],
      matches: [match("past", "2026-09-20")],
      cardsByPlayer: new Map([["recFormer", [{
        id: "card", player: ["recFormer"], match: ["past"], team: "HKFC B", season: SEASON,
        rawPlayerName: "Former Player", playerTeam: "HKFC C",
      }]]]),
    });
    expect(res.fixtures[0].otherPlayers).toEqual([{ id: "recFormer", name: "Former Player", team: "HKFC C" }]);
  });

  it("does not label past picks without match cards as played or show cancelled future picks", () => {
    const res = run({
      players: [player("recB1", "HKFC B"), player("recC1", "HKFC C")],
      matches: [
        match("uncarded", "2026-09-20", { selectedPlayersHome: ["recC1"] }),
        match("cancelled", "2026-10-04", { matchStatus: "Cancelled", selectedPlayersHome: ["recC1"] }),
      ],
      cardedMatchIds: new Set(),
    });
    expect(res.fixtures.every((f) => f.otherPlayers?.length === 0)).toBe(true);
    expect(res.fixtures[0].cardCount).toBeUndefined();
  });

  it("includes unlinked historical match-card names without losing appearances or mixing sides", () => {
    const cards: MatchCard[] = [
      { id: "oldCard", match: ["past"], team: "HKFC B", season: SEASON, rawPlayerName: "Former Guest", playerTeam: "HKFC C" },
      { id: "awayCard", match: ["past"], team: "HKFC C", season: SEASON, rawPlayerName: "Away Guest", playerTeam: "HKFC A" },
    ];
    const res = run({
      players: [player("recB1", "HKFC B"), player("recC1", "HKFC C")],
      matches: [match("past", "2026-09-20", { awayTeam: "HKFC C" })],
      cards: [...cards, cards[0]],
    });
    expect(res.fixtures.find((f) => f.team === "HKFC B")).toMatchObject({
      cardCount: 1, otherPlayers: [{ id: "card:oldCard", name: "Former Guest", team: "HKFC C" }],
    });
    expect(res.fixtures.find((f) => f.team === "HKFC C")).toMatchObject({
      cardCount: 1, otherPlayers: [{ id: "card:awayCard", name: "Away Guest", team: "HKFC A" }],
    });
  });
});
