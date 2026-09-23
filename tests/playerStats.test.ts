import { describe, it, expect } from "vitest";
import { computePlayerSeasonStats } from "../worker/src/playerStats";
import { mapMatchCard } from "../shared/mappers/matchCardMapper";
import type { Match, MatchCard, Player } from "../shared/schema/domainTypes";

const SEASON = "2026-2027";
const TEAM = "HKFC B";

function player(overrides: Partial<Player> = {}): Player {
  return { id: "recP1", active: true, registeredTeam: TEAM, preferredName: "Test", ...overrides };
}

function match(id: string, overrides: Partial<Match> = {}): Match {
  return {
    id,
    matchDate: `2026-09-0${id.slice(-1)}`,
    season: SEASON,
    division: "2",
    competitionType: "LEAGUE",
    homeTeam: TEAM,
    awayTeam: "Opponent",
    homeTeamScore: 0,
    awayTeamScore: 0,
    matchStatus: "Played",
    ...overrides,
  };
}

function card(matchId: string, overrides: Partial<MatchCard> = {}): MatchCard {
  return {
    id: `recC_${matchId}`,
    player: ["recP1"],
    match: [matchId],
    team: TEAM,
    season: SEASON,
    ...overrides,
  } as MatchCard;
}

function build(matches: Match[]) {
  return new Map(matches.map((m) => [m.id, m]));
}

describe("results", () => {
  it("reads win/draw/loss from the side the player turned out for", () => {
    const matchesById = build([
      match("recM1", { homeTeamScore: 3, awayTeamScore: 1 }), // home win
      match("recM2", { homeTeamScore: 2, awayTeamScore: 2 }), // draw
      match("recM3", { homeTeam: "Opponent", awayTeam: TEAM, homeTeamScore: 4, awayTeamScore: 0 }), // away loss
    ]);
    const stats = computePlayerSeasonStats({
      player: player(),
      team: TEAM,
      season: SEASON,
      cards: [card("recM1"), card("recM2"), card("recM3")],
      matchesById,
      exceptions: [],
    });

    const byId = Object.fromEntries(stats.recentGames.map((g) => [g.matchId, g]));
    expect(byId.recM1.outcome).toBe("win");
    expect(byId.recM1.isHome).toBe(true);
    expect(byId.recM2.outcome).toBe("draw");
    expect(byId.recM3.outcome).toBe("loss");
    expect(byId.recM3.isHome).toBe(false);
    expect(byId.recM3.goalsFor).toBe(0); // away side's score, not the home 4
    expect(byId.recM3.goalsAgainst).toBe(4);
  });

  it("returns the most recent games first and caps the list", () => {
    const matchesById = build([
      match("recM1", { matchDate: "2026-09-01" }),
      match("recM2", { matchDate: "2026-09-02" }),
      match("recM3", { matchDate: "2026-09-03" }),
    ]);
    const stats = computePlayerSeasonStats({
      player: player(),
      team: TEAM,
      season: SEASON,
      cards: [card("recM1"), card("recM2"), card("recM3")],
      matchesById,
      exceptions: [],
      recentLimit: 2,
    });
    expect(stats.recentGames.map((g) => g.matchId)).toEqual(["recM3", "recM2"]);
  });

  it("omits games with no score yet rather than scoring them 0-0", () => {
    const matchesById = build([
      match("recM1", { homeTeamScore: undefined, awayTeamScore: undefined }),
    ]);
    const stats = computePlayerSeasonStats({
      player: player(),
      team: TEAM,
      season: SEASON,
      cards: [card("recM1")],
      matchesById,
      exceptions: [],
    });
    expect(stats.recentGames).toHaveLength(0);
    expect(stats.gamesPlayed).toBe(1); // the appearance still counts
  });
});

describe("goals and card points", () => {
  it("totals goals and converts cards using the bye-law points", () => {
    const matchesById = build([match("recM1"), match("recM2")]);
    const stats = computePlayerSeasonStats({
      player: player(),
      team: TEAM,
      season: SEASON,
      cards: [
        card("recM1", { goals: 2, cards: ["Y1"] }), // Y1 = 2 points
        card("recM2", { goals: 1, cards: ["Y2 (2)"] }), // Y2 = 3, x2 = 6
      ],
      matchesById,
      exceptions: [],
    });
    expect(stats.goals).toBe(3);
    expect(stats.cardPoints).toBe(8);
  });

  it("ignores empty and malformed card values", () => {
    const matchesById = build([match("recM1")]);
    const stats = computePlayerSeasonStats({
      player: player(),
      team: TEAM,
      season: SEASON,
      cards: [card("recM1", { cards: ["[]", "nonsense", "Y1"] })],
      matchesById,
      exceptions: [],
    });
    expect(stats.cardPoints).toBe(2);
    expect(stats.recentGames[0].cards).toEqual(["Y1"]);
  });

  it("counts red cards as appearances but not yellow points", () => {
    const matchesById = build([match("recM1")]);
    const stats = computePlayerSeasonStats({
      player: player(),
      team: TEAM,
      season: SEASON,
      cards: [card("recM1", { cards: ["R1"] })],
      matchesById,
      exceptions: [],
    });
    expect(stats.cardPoints).toBe(0);
    expect(stats.recentGames[0].cards).toEqual(["R1"]);
  });
});

describe("participation", () => {
  it("splits the team's games into played, available-not-selected and unavailable", () => {
    const matchesById = build([
      match("recM1"),
      match("recM2"),
      match("recM3"),
      match("recM4"),
    ]);
    const stats = computePlayerSeasonStats({
      player: player(),
      team: TEAM,
      season: SEASON,
      cards: [card("recM1"), card("recM2")], // played 2 of 4
      matchesById,
      exceptions: [
        { player: ["recP1"], match: ["recM3"], availabilityStatus: "Unavailable" },
        { player: ["recP1"], match: ["recM4"], availabilityStatus: "Maybe" }, // not a refusal
      ],
    });

    expect(stats.teamGames).toBe(4);
    expect(stats.gamesPlayed).toBe(2);
    expect(stats.gamesPlayedForTeam).toBe(2);
    expect(stats.gamesUnavailable).toBe(1);
    expect(stats.gamesAvailableNotSelected).toBe(1); // the Maybe game
    expect(stats.gamesNoShow).toBe(0);
    expect(stats.participationPct).toBe(50); // 2/4
    expect(stats.availabilityPct).toBe(75); // (2+1)/4
  });

  it("counts a selected, available player missing from the Match Card as a no-show", () => {
    const matchesById = build([
      match("recM1", { selectedPlayersHome: ["recP1"] }), // played
      match("recM2", { selectedPlayersHome: ["recP1"] }), // picked, never came
      match("recM3", { homeTeam: "Opponent", awayTeam: TEAM, selectedPlayersAway: ["recP1"] }), // away no-show
      match("recM4"), // not picked
    ]);
    const stats = computePlayerSeasonStats({
      player: player(),
      team: TEAM,
      season: SEASON,
      cards: [card("recM1")],
      matchesById,
      exceptions: [],
    });
    expect(stats.gamesNoShow).toBe(2);
    expect(stats.gamesAvailableNotSelected).toBe(1);
    expect(stats.gamesPlayedForTeam).toBe(1);
    // A no-show is not availability.
    expect(stats.availabilityPct).toBe(50); // (1+1)/4
  });

  it("does not call a selected player a no-show once they said they were unavailable", () => {
    const matchesById = build([match("recM1", { selectedPlayersHome: ["recP1"] })]);
    const stats = computePlayerSeasonStats({
      player: player(),
      team: TEAM,
      season: SEASON,
      cards: [],
      matchesById,
      exceptions: [{ player: ["recP1"], match: ["recM1"], availabilityStatus: "Unavailable" }],
    });
    expect(stats.gamesNoShow).toBe(0);
    expect(stats.gamesUnavailable).toBe(1);
  });

  it("does not call a player a no-show when they turned out for another side that day", () => {
    const matchesById = build([
      match("recM1", { matchDate: "2026-09-05", selectedPlayersHome: ["recP1"] }),
      match("recM2", { matchDate: "2026-09-05", homeTeam: "HKFC A", awayTeam: "Opponent" }),
    ]);
    const stats = computePlayerSeasonStats({
      player: player(),
      team: TEAM,
      season: SEASON,
      cards: [card("recM2", { team: "HKFC A" })],
      matchesById,
      exceptions: [],
    });
    expect(stats.gamesNoShow).toBe(0);
    expect(stats.gamesAvailableNotSelected).toBe(1);
  });

  it("counts standing rules and Opt-In Only as unavailable, as selection does", () => {
    const matchesById = build([match("recM1", { matchDate: "2026-09-01" }), match("recM2", { matchDate: "2026-09-02" })]);
    const withRule = computePlayerSeasonStats({
      player: player(),
      team: TEAM,
      season: SEASON,
      cards: [],
      matchesById,
      exceptions: [],
      rules: [{
        id: "recR1",
        player: ["recP1"],
        ruleType: "Date range",
        availability: "Unavailable",
        active: true,
        startDate: "2026-09-01",
        endDate: "2026-09-01",
        notes: "",
        lastModified: "",
      }],
    });
    expect(withRule.gamesUnavailable).toBe(1);
    expect(withRule.gamesAvailableNotSelected).toBe(1);

    const optIn = computePlayerSeasonStats({
      player: player({ optInOnly: true }),
      team: TEAM,
      season: SEASON,
      cards: [],
      matchesById,
      exceptions: [{ player: ["recP1"], match: ["recM2"], availabilityStatus: "Available" }],
    });
    expect(optIn.gamesUnavailable).toBe(1); // recM1: never opted in
    expect(optIn.gamesAvailableNotSelected).toBe(1); // recM2: opted in
  });

  it("ignores another player's exceptions", () => {
    const matchesById = build([match("recM1"), match("recM2")]);
    const stats = computePlayerSeasonStats({
      player: player(),
      team: TEAM,
      season: SEASON,
      cards: [],
      matchesById,
      exceptions: [
        { player: ["recOTHER"], match: ["recM1"], availabilityStatus: "Unavailable" },
      ],
    });
    expect(stats.gamesUnavailable).toBe(0);
    expect(stats.gamesAvailableNotSelected).toBe(2);
  });

  it("counts only played fixtures as team games", () => {
    const matchesById = build([
      match("recM1"),
      match("recM2", { matchStatus: "Scheduled" }),
      match("recM3", { matchStatus: "Cancelled" }),
    ]);
    const stats = computePlayerSeasonStats({
      player: player(),
      team: TEAM,
      season: SEASON,
      cards: [card("recM1")],
      matchesById,
      exceptions: [],
    });
    expect(stats.teamGames).toBe(1);
    expect(stats.participationPct).toBe(100);
  });

  it("returns null percentages before the team has played anything", () => {
    const stats = computePlayerSeasonStats({
      player: player(),
      team: TEAM,
      season: SEASON,
      cards: [],
      matchesById: build([match("recM1", { matchStatus: "Scheduled" })]),
      exceptions: [],
    });
    expect(stats.teamGames).toBe(0);
    expect(stats.participationPct).toBeNull();
    expect(stats.availabilityPct).toBeNull();
  });

  it("counts a play-up appearance as a game played but not as a team game", () => {
    const matchesById = build([
      match("recM1"), // the player's own team
      match("recM2", { homeTeam: "HKFC A", awayTeam: "Opponent" }), // played up
    ]);
    const stats = computePlayerSeasonStats({
      player: player(),
      team: TEAM,
      season: SEASON,
      cards: [card("recM1"), card("recM2", { team: "HKFC A" })],
      matchesById,
      exceptions: [],
    });
    expect(stats.gamesPlayed).toBe(2);
    expect(stats.teamGames).toBe(1);
    // Deliberately allowed to exceed 100%: the player turned out more often
    // than their own team played.
    expect(stats.participationPct).toBe(200);
  });
});

describe("friendlies", () => {
  it("excludes friendlies from appearances, goals and team games", () => {
    const matchesById = build([
      match("recM1"),
      match("recM2", { competitionType: "FRIENDLY" }),
    ]);
    const stats = computePlayerSeasonStats({
      player: player(),
      team: TEAM,
      season: SEASON,
      cards: [card("recM1", { goals: 1 }), card("recM2", { goals: 5, cards: ["Y1"] })],
      matchesById,
      exceptions: [],
    });

    expect(stats.gamesPlayed).toBe(1);
    expect(stats.teamGames).toBe(1);
    expect(stats.goals).toBe(1); // the five friendly goals do not count
    expect(stats.cardPoints).toBe(0);
    expect(stats.recentGames.map((g) => g.matchId)).toEqual(["recM1"]);
  });
});

describe("season boundary", () => {
  it("ignores cards from a previous season", () => {
    const matchesById = build([match("recM1"), match("recM2")]);
    const stats = computePlayerSeasonStats({
      player: player(),
      team: TEAM,
      season: SEASON,
      cards: [card("recM1"), card("recM2", { season: "2025-2026", goals: 9 })],
      matchesById,
      exceptions: [],
    });
    expect(stats.gamesPlayed).toBe(1);
    expect(stats.goals).toBe(0);
  });

  it("counts cards read from Airtable, where Season is a lookup array", () => {
    const raw = mapMatchCard({
      id: "recC1",
      fields: { Player: ["recP1"], Match: ["recM1"], Team: TEAM, Season: [SEASON], "Goals Scored": 2 },
    });
    expect(raw.season).toBe(SEASON);
    const stats = computePlayerSeasonStats({
      player: player(),
      team: TEAM,
      season: SEASON,
      cards: [raw],
      matchesById: build([match("recM1")]),
      exceptions: [],
    });
    expect(stats.gamesPlayed).toBe(1);
    expect(stats.goals).toBe(2);
  });
});
