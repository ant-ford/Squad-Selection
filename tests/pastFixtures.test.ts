import { describe, it, expect } from "vitest";
import { buildPastFixtures } from "../worker/src/fixtures";
import type { Match, MatchCard } from "../shared/schema/domainTypes";

// A Match Card IS the appearance record, so "played" is derived from a card
// rather than from selection. Built from the cached season context, so this
// view costs no extra Airtable calls.

const NOW = new Date("2026-09-10T12:00:00.000Z");
const day = (offset: number) =>
  new Date(NOW.getTime() + offset * 86_400_000).toISOString().split("T")[0];

const match = (over: Partial<Match> & { id: string }): Match =>
  ({
    matchDate: `${day(-3)}T09:00:00.000Z`,
    homeTeam: "A",
    awayTeam: "Rivals",
    matchStatus: "Played",
    homeTeamScore: 3,
    awayTeamScore: 1,
    venue: "Pitch 1",
    division: "Div 1",
    ...over,
  }) as Match;

const card = (over: Partial<MatchCard> & { id: string }): MatchCard =>
  ({ match: ["recM1"], team: "A", ...over }) as MatchCard;

const names = new Map([
  ["recP1", "Alex"],
  ["recP2", "Sam"],
  ["recP3", "Jo"],
]);

const build = (over: Partial<Parameters<typeof buildPastFixtures>[0]> = {}) =>
  buildPastFixtures({
    playerId: "recP1",
    teams: ["A"],
    matches: [match({ id: "recM1" })],
    matchCards: [],
    playerNameById: names,
    now: NOW,
    ...over,
  });

describe("player past fixtures", () => {
  it("reports the result from the player's team's point of view", () => {
    const [f] = build();
    expect(f).toMatchObject({ goalsFor: 3, goalsAgainst: 1, outcome: "win" });
  });

  it("flips the result when the player's team is away", () => {
    const [f] = build({
      matches: [match({ id: "recM1", homeTeam: "Rivals", awayTeam: "A" })],
    });
    expect(f).toMatchObject({ goalsFor: 1, goalsAgainst: 3, outcome: "loss" });
  });

  it("calls a level score a draw", () => {
    const [f] = build({ matches: [match({ id: "recM1", awayTeamScore: 3 })] });
    expect(f.outcome).toBe("draw");
  });

  it("says the player played only when they have a match card", () => {
    expect(build()[0].played).toBe(false);
    expect(build({ matchCards: [card({ id: "c1", player: ["recP1"] })] })[0].played).toBe(true);
  });

  it("carries the player's own goals and cards", () => {
    const [f] = build({
      matchCards: [card({ id: "c1", player: ["recP1"], goals: 2, cards: ["Y"] })],
    });
    expect(f.myGoals).toBe(2);
    expect(f.myCards).toEqual(["Y"]);
  });

  it("lists the team's scorers, most goals first", () => {
    const [f] = build({
      matchCards: [
        card({ id: "c1", player: ["recP1"], goals: 1 }),
        card({ id: "c2", player: ["recP2"], goals: 2 }),
        card({ id: "c3", player: ["recP3"], goals: 0 }),
      ],
    });
    expect(f.scorers).toEqual([
      { name: "Sam", goals: 2 },
      { name: "Alex", goals: 1 },
    ]);
  });

  it("lists only players who were actually carded", () => {
    const [f] = build({
      matchCards: [
        card({ id: "c1", player: ["recP1"], cards: [] }),
        card({ id: "c2", player: ["recP2"], cards: ["Y", "R"] }),
      ],
    });
    expect(f.cards).toEqual([{ name: "Sam", cards: ["Y", "R"] }]);
  });

  it("ignores fixtures that have not been played", () => {
    expect(build({ matches: [match({ id: "recM1", matchStatus: "Scheduled" })] })).toHaveLength(0);
  });

  it("ignores other teams' fixtures the player had no part in", () => {
    expect(
      build({ matches: [match({ id: "recM1", homeTeam: "H", awayTeam: "Rivals" })] }),
    ).toHaveLength(0);
  });

  // A play-up or support appearance is still their game to see.
  it("includes another team's fixture when the player has a card for it", () => {
    const [f] = build({
      matches: [match({ id: "recM1", homeTeam: "B", awayTeam: "Rivals" })],
      matchCards: [card({ id: "c1", player: ["recP1"], team: "B" })],
    });
    expect(f?.hkfcTeam).toBe("B");
    expect(f?.played).toBe(true);
  });

  it("stops at the window, so the list cannot grow all season", () => {
    expect(
      build({ matches: [match({ id: "recM1", matchDate: `${day(-120)}T09:00:00.000Z` })] }),
    ).toHaveLength(0);
  });

  it("returns the most recent fixture first", () => {
    const out = build({
      matches: [
        match({ id: "old", matchDate: `${day(-10)}T09:00:00.000Z` }),
        match({ id: "recent", matchDate: `${day(-1)}T09:00:00.000Z` }),
      ],
    });
    expect(out.map((f) => f.id)).toEqual(["recent", "old"]);
  });
});
