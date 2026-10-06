import { beforeEach, describe, expect, it } from "vitest";
import { decodeSeasonContext, type SeasonContextPayload } from "../worker/src/data/supabase/seasonData";
import { completedLeagueMatchCountsFromSummary, computeCompletedLeagueMatchCounts, evaluatePlayerEligibility } from "../worker/src/eligibility";
import { buildEvaluationContext, getSeasonContext } from "../worker/src/seasonContext";
import { invalidateAll } from "../worker/src/cache";
import type { Env } from "../worker/src/env";
import type { Match, MatchCard } from "../shared/schema/domainTypes";
import { useFakeRepos } from "./helpers/fakeRepos";
import { exception, match, matchCard, person, recId, team } from "./helpers/factories";
import { SUPABASE_TEST_ENV } from "./helpers/postgrest";

/**
 * season_context(p_season, p_player) replaces the season context's six
 * whole-table reads with one call of positional arrays. These pin the
 * decoding, and that the narrower per-player context gives that player
 * exactly what the whole season does.
 */

const PAYLOAD: SeasonContextPayload = {
  v: 1,
  season: "2026-2027",
  prev: "2025-2026",
  people: ["recAnn00000000000", "recBob00000000000"],
  matches: [
    ["recM1", "2026-09-12T01:00:00.000Z", "2", "LEAGUE", "HKFC C", "Valley A", "Played", 3, null, "HKFC", [0], [], ["HKFC C"], 2],
    ["recM2", "2026-10-20T11:00:00.000Z", "2", "LEAGUE", "Kai Tak", "HKFC C", "Scheduled", null, null, null, [], [1, 0], [], 0],
  ],
  cards: [
    [0, 0, "HKFC C", "HKFC D", 2, 2, null, null, null],
    [null, 0, "HKFC C", "HKFC C", 1, null, ["Y2"], "recCard1", "J. Smith"],
  ],
  exceptions: [[1, 1, "M", "Work", "recAns1"], [0, 1, "U", null, null]],
  prevMatches: [["recP1", "2026-05-01T01:00:00.000Z", "2", "LEAGUE", "HKFC C", "Kai Tak", "Played", 1, 1, "KP"]],
  prevCards: [[1, 0, "HKFC C", "HKFC C", 0, ["R1"], "recCard0"]],
  suspensions: [["7", "recBob00000000000", 2, "2026-09-01", "HKFC C", "2026-09-01T02:00:00.000Z"]],
};

describe("decoding season_context", () => {
  const d = decodeSeasonContext(PAYLOAD);

  it("gives matches with their selections, by api id, and blanks as the mappers do", () => {
    expect(d.matches[0]).toMatchObject({
      id: "recM1", season: "2026-2027", competitionType: "LEAGUE", homeTeam: "HKFC C", homeTeamScore: 3, awayTeamScore: 0,
      matchStatus: "Played", selectedPlayersHome: ["recAnn00000000000"], selectedPlayersAway: [],
    });
    expect(d.matches[1]).toMatchObject({ venue: "", selectedPlayersAway: ["recBob00000000000", "recAnn00000000000"] });
    expect(d.previousMatches[0]).toMatchObject({ id: "recP1", season: "2025-2026", homeTeamScore: 1, selectedPlayersHome: [] });
  });

  it("gives cards with their flags, goals, card values, and an unlinked card's name", () => {
    expect(d.cards[0]).toMatchObject({ player: ["recAnn00000000000"], match: ["recM1"], playUp: true, goals: 2, season: "2026-2027" });
    expect(d.cards[0].goalkeeper).toBeUndefined();
    expect(d.cards[0].cards).toBeUndefined();
    expect(d.cards[1]).toMatchObject({ id: "recCard1", player: undefined, goalkeeper: true, cards: ["Y2"], rawPlayerName: "J. Smith" });
    expect(d.previousCards[0]).toMatchObject({ id: "recCard0", player: ["recBob00000000000"], match: ["recP1"], cards: ["R1"], season: "2025-2026" });
  });

  it("gives answers in full words, with a note and id where sent", () => {
    expect(d.exceptions).toEqual([
      { id: "recAns1", player: ["recBob00000000000"], match: ["recM2"], availabilityStatus: "Maybe", note: "Work", season: "2026-2027" },
      { id: "", player: ["recAnn00000000000"], match: ["recM2"], availabilityStatus: "Unavailable", note: "", season: "2026-2027" },
    ]);
  });

  it("gives the open suspensions and the per-match card summary", () => {
    expect(d.suspensions).toEqual([{ id: "7", player: "recBob00000000000", matches: 2, fromDate: "2026-09-01", servingTeam: "HKFC C", createdAt: "2026-09-01T02:00:00.000Z" }]);
    expect([...d.cardSummary]).toEqual([["recM1", { teams: ["HKFC C"], count: 2 }]]);
  });
});

describe("completed-league counts from the card summary", () => {
  it("equal the counts from every card", () => {
    const matches: Match[] = [
      match({ id: "m1", competitionType: "LEAGUE", homeTeam: "HKFC C", awayTeam: "HKFC D" }),
      match({ id: "m2", competitionType: "CUP", division: "Cup", homeTeam: "HKFC C" }),
      match({ id: "m3", competitionType: "LEAGUE", homeTeam: "HKFC D" }),
    ];
    const cards: MatchCard[] = [
      matchCard({ match: ["m1"], team: "HKFC C" }), matchCard({ match: ["m1"], team: "HKFC C" }), matchCard({ match: ["m1"], team: "HKFC D" }),
      matchCard({ match: ["m2"], team: "HKFC C" }), matchCard({ match: ["m3"], team: "HKFC D" }), matchCard({ match: ["m3"] }),
    ];
    const summary = new Map<string, { teams: string[]; count: number }>();
    for (const c of cards) {
      const e = summary.get(c.match![0]) ?? { teams: [], count: 0 };
      e.count++;
      if (c.team && !e.teams.includes(c.team)) e.teams.push(c.team);
      summary.set(c.match![0], e);
    }
    const byId = new Map(matches.map((m) => [m.id, m]));
    expect(completedLeagueMatchCountsFromSummary(summary, byId)).toEqual(computeCompletedLeagueMatchCounts({ matchCards: cards, matchesById: byId }));
  });
});

// ── One player's context against the whole season's ─────────────────────

const SEASON = "2026-2027";
const ANN = recId("Ann");
const BOB = recId("Bob");
const CY = recId("Cy");
const TEAMS = ["A", "B", "C", "D"].map((n, i) => team({ id: recId(`T${n}`), teamName: `HKFC ${n}`, teamRank: i + 1 }));
const day = (n: number, h = 1) => new Date(Date.UTC(2026, 8, 5 + n, h)).toISOString();
const db = useFakeRepos(() => {
  const matches: Match[] = [];
  for (let i = 0; i < 12; i++) {
    const t = TEAMS[i % 4].teamName!;
    matches.push(match({
      id: recId(`M${String(i).padStart(2, "0")}`), season: SEASON, matchDate: day(i % 6, 1 + (i % 3)), homeTeam: t, awayTeam: "Opp",
      competitionType: i % 5 === 0 ? "CUP" : "LEAGUE", matchStatus: i < 8 ? "Played" : "Scheduled",
      selectedPlayersHome: i % 2 ? [BOB, CY] : [ANN],
    }));
  }
  const cards: MatchCard[] = matches.slice(0, 8).flatMap((m, i) => [
    matchCard({ match: [m.id], player: [ANN], team: m.homeTeam, playerTeam: "HKFC C", season: SEASON, playUp: m.homeTeam < "HKFC C" ? true : undefined, goals: i % 3 }),
    matchCard({ match: [m.id], player: [BOB], team: m.homeTeam, playerTeam: "HKFC B", season: SEASON, cards: i === 2 ? ["Y2", "Y2"] : undefined }),
    matchCard({ match: [m.id], player: [CY], team: m.homeTeam, playerTeam: "HKFC D", season: SEASON }),
  ]);
  return {
    teams: TEAMS,
    people: [
      person({ id: ANN, email: "ann@x.com", registeredTeam: "HKFC C" }),
      person({ id: BOB, email: "bob@x.com", registeredTeam: "HKFC B" }),
      person({ id: CY, email: "cy@x.com", registeredTeam: "HKFC D" }),
    ],
    matches,
    matchCards: cards,
    availabilityExceptions: [
      exception({ player: [ANN], match: [matches[9].id], availabilityStatus: "Unavailable", season: SEASON }),
      exception({ player: [CY], match: [matches[9].id], availabilityStatus: "Maybe", season: SEASON }),
      exception({ player: [BOB], match: [matches[10].id], availabilityStatus: "Unavailable", season: SEASON }),
    ],
  };
});
const env = { ...SUPABASE_TEST_ENV } as unknown as Env;
beforeEach(() => invalidateAll());

describe("a player's own season context", () => {
  it("evaluates, counts and suspends that player exactly as the whole season does", async () => {
    const whole = await getSeasonContext(env, SEASON);
    for (const id of [ANN, BOB, CY]) {
      const mine = await getSeasonContext(env, SEASON, id);
      expect(mine.scope).toBe(id);
      expect(mine.matchCardsByPlayer.get(id)).toEqual(whole.matchCardsByPlayer.get(id));
      expect([...mine.matchIdsWithCards].sort()).toEqual([...whole.matchIdsWithCards].sort());
      expect(mine.completedLeagueMatchesByTeam).toEqual(whole.completedLeagueMatchesByTeam);
      expect(mine.suspensionByPlayer.get(id)).toEqual(whole.suspensionByPlayer.get(id));
      expect(mine.exceptionsRaw.filter((e) => e.player?.[0] === id)).toEqual(whole.exceptionsRaw.filter((e) => e.player?.[0] === id));

      const player = db.state.people.find((p) => p.id === id)!;
      const ref = { rankMap: Object.fromEntries(TEAMS.map((t) => [t.teamName!, t.teamRank!])), teamMap: new Map(TEAMS.map((t) => [t.teamName!, t])) };
      for (const m of db.state.matches) {
        for (const side of TEAMS.map((t) => t.teamName!)) {
          const a = await buildEvaluationContext(env, m, ref.rankMap, ref.teamMap, db.state.people, side);
          const b = await buildEvaluationContext(env, m, ref.rankMap, ref.teamMap, db.state.people, side, id);
          expect(evaluatePlayerEligibility(player, m, b.ctx)).toEqual(evaluatePlayerEligibility(player, m, a.ctx));
        }
      }
    }
  });

  it("keeps the squad's answers on the matches someone is selected for, and drops the rest", async () => {
    const mine = await getSeasonContext(env, SEASON, ANN);
    const pairs = mine.exceptionsRaw.map((e) => `${e.player?.[0]}:${e.match?.[0]}`).sort();
    // Cy is selected for match 9, so his answer stays; Bob is not selected for match 10, so his goes.
    expect(pairs).toEqual([`${ANN}:${recId("M09")}`, `${CY}:${recId("M09")}`].sort());
  });
});
