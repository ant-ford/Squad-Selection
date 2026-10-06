import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AvailabilityException, AvailabilityRule, Match, MatchCard, Player, Team } from "../shared/schema/domainTypes";

// ---------------------------------------------------------------------------
// buildEvaluationContext runs once per candidate fixture (well over a hundred
// times for one lower-team player's /api/my-fixtures). Its player index, the
// players with a standing preference, the set of explicit answers and each
// same-day fixture's preference-driven "Unavailable" list are now built once
// and reused. The contexts it returns must not change: this compares them
// against the per-call computation they replaced, on a realistic fake
// season, and then checks that new rules, answers and ranks are picked up.
// ---------------------------------------------------------------------------

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

const SEASON = "2026-2027";
const TEAMS: Team[] = Array.from({ length: 8 }, (_, i) => ({
  id: `t${i + 1}`, teamName: `HKFC ${"ABCDEFGH"[i]}`, teamRank: i + 1, isPremier: i === 0, active: true,
}) as Team);
let rankMap: Record<string, number> = Object.fromEntries(TEAMS.map((t) => [t.teamName, t.teamRank]));
const teamMap = new Map(TEAMS.map((t) => [t.teamName || "", t]));

const players: Player[] = Array.from({ length: 120 }, (_, i) => ({
  id: `p${i}`, active: true, registeredTeam: TEAMS[i % 8].teamName,
  playingPosition: i % 11 === 0 ? "Goalkeeper" : "Defender", playingAbility: "C",
  isVisitingPlayer: false, isSuspended: false, matchesToServe: 0, everRegisteredToPremier: false,
  u21Eligible: i % 17 === 0, preferredName: `P${i}`, optInOnly: i % 13 === 0,
}) as Player);

/** A season shaped like the real one: HKFC sides on most weekend days, some derbies, some midweek games, squads selected. */
function buildSeason() {
  const rand = rng(11);
  const allMatches: Match[] = [];
  const start = Date.UTC(2026, 8, 5, 1); // Saturday 5 Sep 2026, 09:00 HKT
  const now = Date.UTC(2026, 10, 1);
  let n = 0;
  for (let week = 0; week < 30; week++) {
    for (const day of [0, 1, 3]) {
      for (const t of TEAMS) {
        if (rand() < (day === 3 ? 0.9 : 0.5)) continue;
        const ms = start + (week * 7 + day) * 86_400_000 + Math.floor(rand() * 12) * 3_600_000;
        const derby = rand() < 0.05;
        const other = derby ? TEAMS[(TEAMS.indexOf(t) + 1) % 8].teamName : "Opponent";
        const home = rand() < 0.5;
        const squad = players.filter((p) => p.registeredTeam === t.teamName).slice(0, 12).map((p) => p.id);
        allMatches.push({
          id: `m${++n}`, matchDate: new Date(ms).toISOString(), season: SEASON,
          homeTeam: home ? t.teamName : other, awayTeam: home ? other : t.teamName,
          homeTeamScore: 0, awayTeamScore: 0, division: "Division 2",
          competitionType: rand() < 0.1 ? "Cup" : "League",
          matchStatus: ms < now ? "Completed" : "Scheduled",
          selectedPlayersHome: home ? squad : [], selectedPlayersAway: home ? [] : squad,
        } as Match);
      }
    }
  }
  const matchCards: MatchCard[] = [];
  for (const m of allMatches.filter((x) => x.matchStatus === "Completed")) {
    const team = m.homeTeam.startsWith("HKFC") ? m.homeTeam : m.awayTeam;
    for (const pid of [...(m.selectedPlayersHome || []), ...(m.selectedPlayersAway || [])]) {
      matchCards.push({ id: `mc${matchCards.length}`, player: [pid], match: [m.id], team, playerTeam: team, playUp: false, goalkeeper: false, season: SEASON } as MatchCard);
    }
  }
  const exceptions: AvailabilityException[] = Array.from({ length: 900 }, (_, i) => ({
    id: `x${i}`, player: [players[Math.floor(rand() * players.length)].id],
    match: [allMatches[Math.floor(rand() * allMatches.length)].id],
    availabilityStatus: ["Unavailable", "Maybe", "Available"][i % 3], season: SEASON,
  }));
  // Every rule type, Available rules that override Unavailable ones, an
  // inactive rule and a rule for someone not in the player list.
  const types = ["Play-ups", "Support games", "Midweek", "Date range", "All future"] as const;
  const rules: AvailabilityRule[] = [];
  for (let i = 0; i < 45; i++) {
    const type = types[i % types.length];
    rules.push({
      id: `r${rules.length}`, player: [`p${(i * 7) % players.length}`], ruleType: type,
      availability: i % 6 === 5 ? "Available" : i % 4 === 3 ? "Maybe" : "Unavailable",
      active: i % 10 !== 9,
      startDate: type === "Date range" || type === "All future" ? "2026-11-01" : "",
      endDate: type === "Date range" ? "2026-12-15" : "",
      notes: "", lastModified: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}`,
    });
  }
  rules.push({ id: "r-ghost", player: ["not-a-player"], ruleType: "Play-ups", availability: "Unavailable", active: true, startDate: "", endDate: "", notes: "", lastModified: "" });
  return { allMatches, matchCards, exceptions, rules };
}

let data = buildSeason();

vi.mock("../worker/src/cache", async (orig) => {
  const real: any = await orig();
  const memo = new Map<string, unknown>();
  return {
    ...real,
    invalidateAll: () => { memo.clear(); real.invalidateAll(); },
    getShared: async (_env: unknown, key: string, fn: () => Promise<unknown>) => {
      if (!memo.has(key)) memo.set(key, await fn());
      return memo.get(key);
    },
  };
});
vi.mock("../worker/src/data/matches", () => ({
  matches: () => ({ listForSeason: async (s: string) => (s === SEASON ? data.allMatches : []) }),
}));
vi.mock("../worker/src/data/matchCards", () => ({
  matchCards: () => ({ listForSeason: async (s: string) => (s === SEASON ? data.matchCards : []) }),
}));
vi.mock("../worker/src/reference", async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    getExceptionsForSeasons: async () => data.exceptions,
    getReferenceData: async () => ({ players, teams: TEAMS, teamRankMap: rankMap, teamNames: TEAMS.map((t) => t.teamName) }),
  };
});
vi.mock("../worker/src/availabilityRules", async (orig) => {
  const real: any = await orig();
  return { ...real, getAllAvailabilityRules: async () => data.rules };
});

import { buildEvaluationContext, getSeasonContext } from "../worker/src/seasonContext";
import { evaluatePlayerEligibility } from "../worker/src/eligibility";
import { effectiveAvailability, indexRulesByPlayer } from "../worker/src/availabilityRules";
import { UNRANKED_TEAM_RANK } from "../worker/src/reference";
import { invalidateAll } from "../worker/src/cache";
import { hkDateKey } from "../shared/hkDateKey";

const ENV = {} as any;

/** The unavailable set exactly as buildEvaluationContext used to compute it, per call. */
async function referenceUnavailable(match: Match, sameDayFixtures: { matchId: string; teamName: string }[], playerList: Player[]) {
  const season = await getSeasonContext(ENV, SEASON);
  const playersById = new Map<string, Player>();
  for (const p of playerList) playersById.set(p.id, p);
  const unavailable = new Set(season.unavailablePlayerMatchKeys);
  const rulesByPlayer = indexRulesByPlayer(data.rules);
  const nonDefault = new Set<string>([...rulesByPlayer.keys(), ...playerList.filter((p) => p.optInOnly).map((p) => p.id)]);
  if (nonDefault.size > 0 && sameDayFixtures.length > 0) {
    const answered = new Set(season.exceptionIndex.map((e) => `${e.playerId}:${e.matchId}`));
    const sameDay = hkDateKey(match.matchDate);
    for (const playerId of nonDefault) {
      const player = playersById.get(playerId);
      if (!player) continue;
      const rules = rulesByPlayer.get(playerId) ?? [];
      const playerRank = rankMap[player.registeredTeam || ""] ?? UNRANKED_TEAM_RANK;
      for (const fixture of sameDayFixtures) {
        const key = `${playerId}:${fixture.matchId}`;
        if (answered.has(key)) continue;
        const fixtureRank = rankMap[fixture.teamName] ?? UNRANKED_TEAM_RANK;
        const { status } = effectiveAvailability("", rules, {
          date: sameDay, isPlayUp: fixtureRank < playerRank, isSupport: fixtureRank > playerRank,
        }, { optInOnly: player.optInOnly });
        if (status === "Unavailable") unavailable.add(key);
      }
    }
  }
  return unavailable;
}

function hkfcSides(m: Match) {
  return [m.homeTeam, m.awayTeam].filter((t) => rankMap[t] !== undefined);
}

const sorted = (s: Iterable<string>) => [...s].sort();

beforeEach(() => {
  data = buildSeason();
  rankMap = Object.fromEntries(TEAMS.map((t) => [t.teamName, t.teamRank]));
  invalidateAll();
});

describe("buildEvaluationContext per-fixture reuse", () => {
  it("has a season worth testing: same-day fixtures, preference-driven additions", async () => {
    let withSameDay = 0;
    let withAdditions = 0;
    for (const m of data.allMatches) {
      for (const team of hkfcSides(m)) {
        const { ctx } = await buildEvaluationContext(ENV, m, rankMap, teamMap, players, team);
        if (ctx.sameDayFixtures.length > 0) withSameDay++;
        const season = await getSeasonContext(ENV, SEASON);
        if (ctx.unavailablePlayerMatchKeys.size > season.unavailablePlayerMatchKeys.size) withAdditions++;
      }
    }
    expect(data.allMatches.length).toBeGreaterThan(200);
    expect(withSameDay).toBeGreaterThan(100);
    expect(withAdditions).toBeGreaterThan(50);
  });

  it("gives every fixture the same unavailable set, player index and verdicts as the per-call computation", async () => {
    for (const m of data.allMatches) {
      for (const team of hkfcSides(m)) {
        const { ctx } = await buildEvaluationContext(ENV, m, rankMap, teamMap, players, team);
        const expected = await referenceUnavailable(m, ctx.sameDayFixtures, players);
        expect(sorted(ctx.unavailablePlayerMatchKeys)).toEqual(sorted(expected));
        expect([...ctx.playersById.entries()]).toEqual(players.map((p) => [p.id, p]));
      }
    }
  });

  it("gives the same eligibility verdicts as contexts built the old way", async () => {
    const sample = data.allMatches.filter((_, i) => i % 3 === 0);
    for (const m of sample) {
      for (const team of hkfcSides(m)) {
        const { ctx } = await buildEvaluationContext(ENV, m, rankMap, teamMap, players, team);
        const oldCtx = { ...ctx, unavailablePlayerMatchKeys: await referenceUnavailable(m, ctx.sameDayFixtures, players) };
        for (const p of players) {
          expect(evaluatePlayerEligibility(p, m, ctx)).toEqual(evaluatePlayerEligibility(p, m, oldCtx));
        }
      }
    }
  });

  it("never adds to the season's own unavailable set", async () => {
    const season = await getSeasonContext(ENV, SEASON);
    const before = sorted(season.unavailablePlayerMatchKeys);
    for (const m of data.allMatches) {
      for (const team of hkfcSides(m)) await buildEvaluationContext(ENV, m, rankMap, teamMap, players, team);
    }
    expect(sorted(season.unavailablePlayerMatchKeys)).toEqual(before);
  });

  // The cases below find a same-day pair: an HKFC fixture and a higher HKFC
  // team playing the same Hong Kong day, with a player from the lower team.
  async function sameDayPair() {
    for (const m of data.allMatches) {
      for (const team of hkfcSides(m)) {
        const { ctx } = await buildEvaluationContext(ENV, m, rankMap, teamMap, players, team);
        const higher = ctx.sameDayFixtures.find((f) => rankMap[f.teamName] < rankMap[team]);
        if (!higher) continue;
        const player = players.find((p) => p.registeredTeam === team && !p.optInOnly
          && !data.rules.some((r) => r.player?.[0] === p.id)
          && !data.exceptions.some((e) => e.player?.[0] === p.id && e.match?.[0] === higher.matchId));
        if (player) return { m, team, higher, player };
      }
    }
    throw new Error("no same-day pair in the fake season");
  }

  it("picks up a new rule (a new rules list)", async () => {
    const { m, team, higher, player } = await sameDayPair();
    const key = `${player.id}:${higher.matchId}`;
    expect((await buildEvaluationContext(ENV, m, rankMap, teamMap, players, team)).ctx.unavailablePlayerMatchKeys.has(key)).toBe(false);
    data.rules = [...data.rules, { id: "r-new", player: [player.id], ruleType: "Play-ups", availability: "Unavailable", active: true, startDate: "", endDate: "", notes: "", lastModified: "2026-10-06" }];
    expect((await buildEvaluationContext(ENV, m, rankMap, teamMap, players, team)).ctx.unavailablePlayerMatchKeys.has(key)).toBe(true);
  });

  it("lets a new explicit answer win once the season context is rebuilt", async () => {
    const { m, team, higher, player } = await sameDayPair();
    const key = `${player.id}:${higher.matchId}`;
    data.rules = [...data.rules, { id: "r-new", player: [player.id], ruleType: "Play-ups", availability: "Unavailable", active: true, startDate: "", endDate: "", notes: "", lastModified: "2026-10-06" }];
    expect((await buildEvaluationContext(ENV, m, rankMap, teamMap, players, team)).ctx.unavailablePlayerMatchKeys.has(key)).toBe(true);
    data.exceptions = [...data.exceptions, { id: "x-new", player: [player.id], match: [higher.matchId], availabilityStatus: "Available", season: SEASON }];
    invalidateAll(); // what setAvailability does to the season index
    data.rules = [...data.rules]; // and the shared reads come back as new arrays
    expect((await buildEvaluationContext(ENV, m, rankMap, teamMap, players, team)).ctx.unavailablePlayerMatchKeys.has(key)).toBe(false);
  });

  it("follows a change of team ranks (a new rank map)", async () => {
    const { m, team, higher, player } = await sameDayPair();
    const key = `${player.id}:${higher.matchId}`;
    data.rules = [...data.rules, { id: "r-new", player: [player.id], ruleType: "Play-ups", availability: "Unavailable", active: true, startDate: "", endDate: "", notes: "", lastModified: "2026-10-06" }];
    expect((await buildEvaluationContext(ENV, m, rankMap, teamMap, players, team)).ctx.unavailablePlayerMatchKeys.has(key)).toBe(true);
    // Swap the two teams' ranks: the same fixture is now a support game, not a play-up.
    rankMap = { ...rankMap, [team]: rankMap[higher.teamName], [higher.teamName]: rankMap[team] };
    expect((await buildEvaluationContext(ENV, m, rankMap, teamMap, players, team)).ctx.unavailablePlayerMatchKeys.has(key)).toBe(false);
  });

  it("follows a new player list", async () => {
    const { m, team, higher, player } = await sameDayPair();
    const key = `${player.id}:${higher.matchId}`;
    const flagged = players.map((p) => (p.id === player.id ? { ...p, optInOnly: true } : p));
    expect((await buildEvaluationContext(ENV, m, rankMap, teamMap, players, team)).ctx.unavailablePlayerMatchKeys.has(key)).toBe(false);
    const { ctx } = await buildEvaluationContext(ENV, m, rankMap, teamMap, flagged, team);
    expect(ctx.unavailablePlayerMatchKeys.has(key)).toBe(true);
    expect(ctx.playersById.get(player.id)?.optInOnly).toBe(true);
  });
});
