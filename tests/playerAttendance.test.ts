import { describe, it, expect } from "vitest";
import { computePlayerAttendance, type PlayerAttendanceInput } from "../worker/src/playerAttendance";
import type { AvailabilityRule, Match, MatchCard, Player } from "../shared/schema/domainTypes";

const SEASON = "2026-2027";
const TODAY = "2026-10-01";
const RANKS = { "HKFC A": 1, "HKFC B": 2, "HKFC C": 3 };

function player(overrides: Partial<Player> = {}): Player {
  return { id: "recP1", active: true, registeredTeam: "HKFC B", preferredName: "Test", ...overrides };
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
    homeTeamScore: 2,
    awayTeamScore: 1,
    matchStatus: date < TODAY ? "Played" : "Scheduled",
    ...overrides,
  };
}

function card(matchId: string, team = "HKFC B", overrides: Partial<MatchCard> = {}): MatchCard {
  return { id: `recC_${matchId}`, player: ["recP1"], match: [matchId], team, season: SEASON, goals: 0, ...overrides };
}

function rule(overrides: Partial<AvailabilityRule>): AvailabilityRule {
  return {
    id: "recR1", player: ["recP1"], ruleType: "", availability: "", active: true,
    startDate: "", endDate: "", notes: "", lastModified: "2026-09-01T00:00:00Z", ...overrides,
  };
}

/** Unless a test says otherwise, every match has Match Cards (someone's). */
function run(overrides: Partial<PlayerAttendanceInput>) {
  return computePlayerAttendance({
    player: player(),
    team: "HKFC B",
    season: SEASON,
    today: TODAY,
    teamRankMap: RANKS,
    matches: [],
    cards: [],
    cardedMatchIds: new Set((overrides.matches ?? []).map((m) => m.id)),
    exceptions: [],
    ...overrides,
  });
}

const cellFor = (res: ReturnType<typeof run>, matchId: string, team = "HKFC B") =>
  res.cells.find((c) => c.matchId === matchId && c.team === team)!;

describe("computePlayerAttendance", () => {
  it("orders rows by team rank and columns by date, skipping teams with no fixtures", () => {
    const res = run({
      player: player({ registeredTeam: "HKFC C" }),
      team: "HKFC C",
      matches: [
        match("m2", "2026-09-20", { homeTeam: "HKFC C" }),
        match("m1", "2026-09-13", { homeTeam: "HKFC A" }),
      ],
    });
    expect(res.teams).toEqual(["HKFC A", "HKFC C"]);
    expect(res.dates).toEqual(["2026-09-13", "2026-09-20"]);
  });

  it("shows only the registered team and those above it, plus any lower team actually played for", () => {
    const res = run({
      matches: [
        match("m1", "2026-09-13", { homeTeam: "HKFC A" }),
        match("m2", "2026-09-13"),
        match("m3", "2026-09-20", { homeTeam: "HKFC C" }),
        match("m4", "2026-10-04", { homeTeam: "HKFC C" }),
      ],
    });
    expect(res.teams).toEqual(["HKFC A", "HKFC B"]);
    expect(res.dates).toEqual(["2026-09-13"]);
    expect(res.cells.every((c) => c.team !== "HKFC C")).toBe(true);

    const reRegistered = run({
      matches: [match("m3", "2026-09-20", { homeTeam: "HKFC C" }), match("m4", "2026-10-04", { homeTeam: "HKFC C" })],
      cards: [card("m3", "HKFC C")],
    });
    expect(reRegistered.teams).toEqual(["HKFC C"]);
    expect(reRegistered.dates).toEqual(["2026-09-20", "2026-10-04"]);
  });

  it("marks past fixtures played, not selected, unavailable and no-show", () => {
    const res = run({
      matches: [
        match("m1", "2026-09-06"),
        match("m2", "2026-09-13"),
        match("m3", "2026-09-20"),
        match("m4", "2026-09-27", { selectedPlayersHome: ["recP1"] }),
      ],
      cards: [card("m1", "HKFC B", { goals: 2 })],
      exceptions: [{ player: ["recP1"], match: ["m3"], availabilityStatus: "Unavailable" }],
    });
    expect(cellFor(res, "m1")).toMatchObject({ status: "played", goals: 2, goalsFor: 2, goalsAgainst: 1, past: true });
    expect(cellFor(res, "m2").status).toBe("not-selected");
    expect(cellFor(res, "m3")).toMatchObject({ status: "unavailable", source: "answer" });
    expect(cellFor(res, "m4").status).toBe("no-show");
  });

  it("points the day's other fixtures at the side the player turned out for", () => {
    const res = run({
      matches: [
        match("m1", "2026-09-13", { homeTeam: "HKFC A", selectedPlayersHome: ["recP1"] }),
        match("m2", "2026-09-13"),
        match("m3", "2026-10-04", { homeTeam: "HKFC A", selectedPlayersHome: ["recP1"] }),
        match("m4", "2026-10-04"),
      ],
      cards: [card("m1", "HKFC A")],
    });
    expect(cellFor(res, "m1", "HKFC A").status).toBe("played");
    expect(cellFor(res, "m2")).toMatchObject({ status: "elsewhere", elsewhereTeam: "HKFC A" });
    expect(cellFor(res, "m3", "HKFC A").status).toBe("selected");
    expect(cellFor(res, "m4")).toMatchObject({ status: "elsewhere", elsewhereTeam: "HKFC A" });
  });

  it("takes a pick for a match with no Match Cards (a hand-entered friendly) as played, never a no-show", () => {
    const res = run({
      matches: [
        match("m1", "2026-09-13", { competitionType: "FRIENDLY", selectedPlayersHome: ["recP1"] }),
        match("m2", "2026-09-13", { homeTeam: "HKFC A" }),
        match("m3", "2026-09-20", { competitionType: "FRIENDLY" }),
        match("m4", "2026-09-27", { matchStatus: "Scheduled", selectedPlayersHome: ["recP1"] }),
      ],
      cardedMatchIds: new Set(["m2"]),
    });
    expect(cellFor(res, "m1")).toMatchObject({ status: "played", assumed: true, friendly: true });
    expect(cellFor(res, "m1").goals).toBeUndefined();
    expect(cellFor(res, "m2", "HKFC A")).toMatchObject({ status: "elsewhere", elsewhereTeam: "HKFC B" });
    expect(cellFor(res, "m3").status).toBe("not-selected");
    expect(cellFor(res, "m4")).toMatchObject({ status: "played", assumed: true });
  });

  it("does not call a player moved to another side on the day a no-show", () => {
    const res = run({
      matches: [
        match("m1", "2026-09-13", { selectedPlayersHome: ["recP1"] }),
        match("m2", "2026-09-13", { homeTeam: "HKFC A" }),
      ],
      cards: [card("m2", "HKFC A")],
    });
    expect(cellFor(res, "m1")).toMatchObject({ status: "elsewhere", elsewhereTeam: "HKFC A" });
  });

  it("resolves future availability per side, so a play-up rule only hits higher teams", () => {
    const res = run({
      matches: [
        match("m1", "2026-10-04", { homeTeam: "HKFC A" }),
        match("m2", "2026-10-04"),
        match("m3", "2026-10-11"),
      ],
      rules: [rule({ ruleType: "Play-ups", availability: "Unavailable" })],
      exceptions: [{ player: ["recP1"], match: ["m3"], availabilityStatus: "Maybe" }],
    });
    expect(cellFor(res, "m1", "HKFC A")).toMatchObject({ status: "unavailable", source: "rule", past: false });
    expect(cellFor(res, "m2")).toMatchObject({ status: "available", source: "default" });
    expect(cellFor(res, "m3")).toMatchObject({ status: "maybe", source: "answer" });
  });

  it("treats an unanswered fixture as unavailable for an opt-in-only player", () => {
    const res = run({ player: player({ optInOnly: true }), matches: [match("m1", "2026-10-04")] });
    expect(cellFor(res, "m1")).toMatchObject({ status: "unavailable", source: "opt-in" });
  });

  it("puts a derby on both rows and reads the card's side", () => {
    const res = run({
      matches: [match("m1", "2026-09-13", { homeTeam: "HKFC B", awayTeam: "HKFC C" })],
      cards: [card("m1", "HKFC C")],
    });
    expect(cellFor(res, "m1", "HKFC C")).toMatchObject({ status: "played", isHome: false, goalsFor: 1 });
    expect(cellFor(res, "m1", "HKFC B")).toMatchObject({ status: "elsewhere", elsewhereTeam: "HKFC C" });
  });

  it("shows cancelled fixtures as off, and keeps a past fixture awaiting its result as selected", () => {
    const res = run({
      matches: [
        match("m1", "2026-09-13", { matchStatus: "Cancelled" }),
        match("m2", "2026-09-27", { matchStatus: "Scheduled", selectedPlayersHome: ["recP1"] }),
      ],
    });
    expect(cellFor(res, "m1").status).toBe("off");
    expect(cellFor(res, "m2")).toMatchObject({ status: "selected", past: true });
  });

  it("ignores other seasons and non-HKFC sides", () => {
    const res = run({
      matches: [
        match("m1", "2025-09-13", { season: "2025-2026" }),
        match("m2", "2026-09-13", { homeTeam: "Opponent", awayTeam: "Someone" }),
      ],
    });
    expect(res.cells).toEqual([]);
    expect(res.teams).toEqual([]);
  });
});
