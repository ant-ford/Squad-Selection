import { describe, it, expect } from "vitest";
import { cardsPerGame, luckyCharms, umpireRows, umpireSplits } from "../shared/luck";
import type { PlayerSeason, SeasonSummary, TeamSeason, UmpireSeason, WDL } from "../shared/clubStats";

const wdl = (w: number, d: number, l: number): WDL => ({ w, d, l });
const team = (name: string, r: WDL): TeamSeason => ({
  team: name, played: r.w + r.d + r.l, ...r, gf: 0, ga: 0, cleanSheets: 0,
  leagues: {}, home: wdl(0, 0, 0), away: wdl(0, 0, 0), venues: {}, opponents: {},
});
const player = (key: string, name: string, teams: Record<string, WDL>): PlayerSeason => ({
  key,
  name,
  teams: Object.fromEntries(
    Object.entries(teams).map(([t, r]) => [t, { apps: r.w + r.d + r.l, goals: 0, captain: 0, keeper: 0, playUps: 0, ...r }]),
  ),
});
const umpire = (key: string, name: string, over: Partial<UmpireSeason>): UmpireSeason => ({
  key, name, games: 0, appointed: 0, duty: 0, hkfc: wdl(0, 0, 0), derbies: 0, cardsToHkfc: 0, ...over,
});
const season = (s: string, over: Partial<SeasonSummary>): SeasonSummary => ({
  version: 6, season: s, generatedAt: "", matches: 0, derbies: 0, teams: [], players: [], umpires: [],
  umpireSplits: { appointed: wdl(0, 0, 0), duty: wdl(0, 0, 0), unknown: wdl(0, 0, 0) }, ...over,
});

describe("lucky charms", () => {
  const s1 = season("2023-2024", {
    teams: [team("HKFC D", wdl(12, 2, 6))],
    players: [
      player("recLucky", "Lucky Lee", { "HKFC D": wdl(10, 1, 1) }), // 83% with, 25% without
      player("recUnlucky", "Una Luck", { "HKFC D": wdl(4, 1, 5) }), // 40% with, 80% without
      player("recRare", "Rare Ron", { "HKFC D": wdl(3, 0, 0) }), // too few games with
      player("recAlways", "Ever Present", { "HKFC D": wdl(12, 2, 5) }), // too few without
    ],
  });
  // Results only, from before Match Cards: must not count as games "without" anyone.
  const old = season("2019-2020", { teams: [team("HKFC D", wdl(0, 0, 15))] });

  it("compares the team with and without each player, over seasons with Match Cards", () => {
    const charms = luckyCharms([s1, old]);
    expect(charms.map((c) => c.name)).toEqual(["Lucky Lee", "Una Luck"]);
    expect(charms[0]).toMatchObject({
      team: "HKFC D",
      with: { w: 10, d: 1, l: 1 },
      without: { w: 2, d: 1, l: 5 },
      withPct: 83,
      withoutPct: 25,
      lift: 58,
    });
    expect(charms[1]).toMatchObject({ without: { w: 8, d: 1, l: 1 }, withPct: 40, withoutPct: 80, lift: -40 });
  });

  it("leaves out players below either minimum", () => {
    const names = luckyCharms([s1]).map((c) => c.name);
    expect(names).not.toContain("Rare Ron");
    expect(names).not.toContain("Ever Present");
    expect(luckyCharms([s1], { minWith: 3, minWithout: 1 }).map((c) => c.name)).toContain("Ever Present");
  });

  it("counts games without them only in seasons they played for the team", () => {
    // Lucky Lee was not at the club in 2024-25: D's results that season are not "without" him.
    const later = season("2024-2025", {
      teams: [team("HKFC D", wdl(0, 0, 20))],
      players: [player("recOther", "Some One", { "HKFC D": wdl(0, 0, 20) })],
    });
    expect(luckyCharms([s1, later]).find((c) => c.key === "recLucky")).toMatchObject({ without: { w: 2, d: 1, l: 5 } });
  });

  it("adds a player's seasons together, team by team", () => {
    const s2 = season("2024-2025", {
      teams: [team("HKFC D", wdl(6, 0, 4))],
      players: [player("recLucky", "Lucky Lee", { "HKFC D": wdl(5, 0, 1) })],
    });
    expect(luckyCharms([s1, s2]).find((c) => c.key === "recLucky")).toMatchObject({
      with: { w: 15, d: 1, l: 2 },
      without: { w: 3, d: 1, l: 8 },
    });
  });
});

describe("umpires", () => {
  const withCards = season("2023-2024", {
    players: [player("recAny", "Any One", { "HKFC A": wdl(1, 0, 0) })],
    umpires: [umpire("alex wong", "Alex Wong", { games: 4, appointed: 4, hkfc: wdl(3, 0, 1), cardsToHkfc: 6 })],
    umpireSplits: { appointed: wdl(3, 0, 1), duty: wdl(1, 1, 0), unknown: wdl(0, 0, 0) },
  });
  const beforeCards = season("2018-2019", {
    umpires: [
      umpire("alex wong", "ALEX WONG", { games: 2, appointed: 2, hkfc: wdl(0, 0, 2) }),
      umpire("jo blake", "Jo Blake", { games: 3, duty: 3, hkfc: wdl(1, 1, 1), derbies: 0 }),
    ],
    umpireSplits: { appointed: wdl(0, 0, 2), duty: wdl(1, 1, 1), unknown: wdl(1, 0, 0) },
  });

  it("adds each umpire up across seasons, most games first", () => {
    const rows = umpireRows([withCards, beforeCards]);
    expect(rows.map((r) => r.key)).toEqual(["alex wong", "jo blake"]);
    // The latest season's spelling wins.
    expect(rows[0]).toMatchObject({ name: "Alex Wong", games: 6, appointed: 6, hkfc: { w: 3, d: 0, l: 3 } });
  });

  it("counts cards per game only over seasons that record cards", () => {
    const [alex, jo] = umpireRows([withCards, beforeCards]);
    expect(alex).toMatchObject({ cards: 6, cardGames: 4 });
    expect(cardsPerGame(alex)).toBe(1.5);
    expect(cardsPerGame(jo)).toBeNull();
    expect(cardsPerGame(alex, 5)).toBeNull();
  });

  it("adds up HKFC's results by who umpired", () => {
    expect(umpireSplits([withCards, beforeCards])).toEqual({
      appointed: { w: 3, d: 0, l: 3 },
      duty: { w: 2, d: 2, l: 1 },
      unknown: { w: 1, d: 0, l: 0 },
    });
  });
});
