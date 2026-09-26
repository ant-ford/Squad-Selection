import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Stats page: the per-season summary (built from Matches and Match Cards),
// adding seasons up, and the route - including that no other player's cards
// ever reach the page.
// ---------------------------------------------------------------------------

import { fakeAirtable, type FakeTables } from "./helpers/airtable";
import { invalidateAll } from "../worker/src/cache";
import { resetMissingFieldCache } from "../worker/src/airtable";
import { buildSeasonSummary } from "../worker/src/clubStats";
import { clubRecord, combineSeasons, leaders, splitsAcrossTeams, type SeasonSummary } from "../shared/clubStats";
import type { Match, MatchCard } from "../shared/schema/domainTypes";
import worker from "../worker/src/index";

const match = (id: string, over: Partial<Match>): Match => ({
  id,
  matchDate: "2025-10-05T06:00:00.000Z",
  season: "2025-2026",
  division: "",
  competitionType: "LEAGUE",
  homeTeam: "",
  homeTeamScore: 0,
  awayTeam: "",
  awayTeamScore: 0,
  matchStatus: "Played",
  venue: "HKFC",
  ...over,
});
const card = (id: string, matchId: string, team: string, over: Partial<MatchCard> = {}): MatchCard => ({
  id,
  match: [matchId],
  team,
  ...over,
});

const MATCHES: Match[] = [
  match("m1", { homeTeam: "HKFC A", homeTeamScore: 3, awayTeam: "Valley A", awayTeamScore: 1, division: "Premier", ump1: "Appt - Alex Wong", ump2: "Appointed" }),
  match("m2", { homeTeam: "KCC B", homeTeamScore: 2, awayTeam: "HKFC B", awayTeamScore: 2, venue: "KCC", ump1: "HKFC B - Sam Lee", ump2: "KCC B - Jo Blake" }),
  match("m3", { homeTeam: "HKFC A", homeTeamScore: 1, awayTeam: "HKFC B", awayTeamScore: 0, ump1: "Appt - Alex Wong" }), // derby
  match("m4", { homeTeam: "Valley A", awayTeam: "HKFC A", competitionType: "FRIENDLY" }),
  // An older season's row: no status, but it has cards and is in the past.
  match("m5", { homeTeam: "HKFC B", homeTeamScore: 0, awayTeam: "Pak A", awayTeamScore: 2, matchStatus: "" }),
  match("m6", { homeTeam: "Valley A", awayTeam: "KCC B" }), // not HKFC
  match("m7", { homeTeam: "HKFC A", awayTeam: "Pak A", matchStatus: "Cancelled" }),
];
const CARDS: MatchCard[] = [
  card("c1", "m1", "HKFC A", { player: ["recP1"], goals: 2, captain: true, cards: ["Y2"] }),
  card("c2", "m3", "HKFC A", { player: ["recP1"], goals: 1 }),
  card("c3", "m1", "HKFC A", { player: ["recP2"], goalkeeper: true }),
  card("c4", "m2", "HKFC B", { player: ["recP2"], playUp: true }),
  card("c5", "m2", "HKFC B", { rawPlayerName: "Old  TIMER", goals: 1, cards: ["R1"] }),
  card("c6", "m3", "HKFC B", { player: ["recP3"] }),
  card("c7", "m5", "HKFC B", { player: ["recP3"] }),
  card("c8", "m4", "HKFC A", { player: ["recP1"], goals: 5 }), // friendly: ignored
];
const NAMES = { recP1: "Pat Player", recP2: "Kim Keeper", recP3: "Sam Sub" };

const built = () =>
  buildSeasonSummary({ season: "2025-2026", matches: MATCHES, cards: CARDS, names: NAMES, today: "2026-09-26" });

describe("a season's summary", () => {
  it("counts HKFC games that were played: not friendlies, other clubs' or cancelled ones", () => {
    const { summary } = built();
    expect(summary.matches).toBe(4);
    expect(summary.derbies).toBe(1);
  });

  it("gives each team its record, splits and opponents", () => {
    const { teams } = built().summary;
    expect(teams.find((t) => t.team === "HKFC A")).toEqual({
      team: "HKFC A",
      division: "Premier",
      played: 2, w: 2, d: 0, l: 0, gf: 4, ga: 1, cleanSheets: 1,
      leagues: {
        Premier: { w: 1, d: 0, l: 0, gf: 3, ga: 1 },
        Other: { w: 1, d: 0, l: 0, gf: 1, ga: 0 },
      },
      home: { w: 2, d: 0, l: 0 },
      away: { w: 0, d: 0, l: 0 },
      venues: { HKFC: { w: 2, d: 0, l: 0 } },
      opponents: {
        "Valley A": { w: 1, d: 0, l: 0, gf: 3, ga: 1 },
        "HKFC B": { w: 1, d: 0, l: 0, gf: 1, ga: 0 },
      },
    });
    expect(teams.find((t) => t.team === "HKFC B")).toMatchObject({ played: 3, w: 0, d: 1, l: 2, gf: 2, ga: 5, away: { w: 0, d: 1, l: 1 } });
  });

  it("gives each player their games by team, keyed by People record or by name", () => {
    const { players } = built().summary;
    expect(players.find((p) => p.key === "recP1")).toEqual({
      key: "recP1",
      name: "Pat Player",
      teams: { "HKFC A": { apps: 2, goals: 3, captain: 1, keeper: 0, playUps: 0, w: 2, d: 0, l: 0 } },
    });
    expect(players.find((p) => p.key === "recP2")!.teams).toEqual({
      "HKFC A": { apps: 1, goals: 0, captain: 0, keeper: 1, playUps: 0, w: 1, d: 0, l: 0 },
      "HKFC B": { apps: 1, goals: 0, captain: 0, keeper: 0, playUps: 1, w: 0, d: 1, l: 0 },
    });
    expect(players.find((p) => p.key === "raw:old timer")).toMatchObject({ name: "Old  TIMER" });
  });

  it("matches a card with no People link to the player by full name", () => {
    const { summary } = buildSeasonSummary({
      season: "2025-2026",
      matches: MATCHES,
      cards: [
        card("x1", "m1", "HKFC A", { player: ["recP1"], goals: 1 }),
        // HKHA's "SURNAME Given Names" for the same person.
        card("x2", "m2", "HKFC B", { rawPlayerName: "PLAYER Patrick James", goals: 2 }),
        // Two people share this name, so neither is matched.
        card("x3", "m2", "HKFC B", { rawPlayerName: "LEE Sam" }),
      ],
      names: NAMES,
      byFullName: { "james patrick player": "recP1", "lee sam": "" },
      today: "2026-09-26",
    });
    expect(summary.players.find((p) => p.key === "recP1")!.teams).toMatchObject({
      "HKFC A": { apps: 1, goals: 1 },
      "HKFC B": { apps: 1, goals: 2 },
    });
    expect(summary.players.map((p) => p.key).sort()).toEqual(["raw:lee sam", "recP1"]);
  });

  it("keeps cards out of the summary, aside for each player's own page", () => {
    const { summary, cardsByPlayer } = built();
    expect(JSON.stringify(summary)).not.toMatch(/Y2|R1|"cards"|yellow|red/);
    expect(cardsByPlayer).toEqual({ recP1: { yellow: 1, red: 0 }, "raw:old timer": { yellow: 0, red: 1 } });
  });

  it("gives each umpire their HKFC games, results and cards, leaving derbies out of the results", () => {
    const { umpires, umpireSplits } = built().summary;
    expect(umpires.find((u) => u.key === "alex wong")).toEqual({
      key: "alex wong", name: "Alex Wong", games: 2, appointed: 2, duty: 0,
      hkfc: { w: 1, d: 0, l: 0 }, derbies: 1, cardsToHkfc: 1,
    });
    expect(umpires.find((u) => u.key === "lee sam")).toMatchObject({ games: 1, duty: 1, hkfc: { w: 0, d: 1, l: 0 }, cardsToHkfc: 1 });
    expect(umpires.map((u) => u.key).sort()).toEqual(["alex wong", "blake jo", "lee sam"]);
    expect(umpireSplits).toEqual({
      appointed: { w: 1, d: 0, l: 0 },
      duty: { w: 0, d: 1, l: 0 },
      unknown: { w: 0, d: 0, l: 1 },
    });
  });
});

describe("adding seasons up", () => {
  const one = built().summary;
  const two: SeasonSummary = { ...structuredClone(one), season: "2024-2025" };

  it("merges teams, players and umpires across seasons", () => {
    const period = combineSeasons([one, two]);
    expect(period.seasons).toEqual(["2024-2025", "2025-2026"]);
    expect(period.seasonsWithoutPlayers).toEqual([]);
    const resultsOnly: SeasonSummary = { ...structuredClone(one), season: "2019-2020", players: [] };
    expect(combineSeasons([one, resultsOnly]).seasonsWithoutPlayers).toEqual(["2019-2020"]);
    expect(period.matches).toBe(8);
    expect(period.teams.find((t) => t.team === "HKFC A")).toMatchObject({
      played: 4, w: 4, gf: 8, opponents: { "Valley A": { w: 2, gf: 6 } }, leagues: { Premier: { w: 2, gf: 6 } },
    });
    expect(period.players.find((p) => p.key === "recP1")!.teams["HKFC A"]).toMatchObject({ apps: 4, goals: 6 });
    expect(period.umpires.find((u) => u.key === "alex wong")).toMatchObject({ games: 4, hkfc: { w: 2 } });
  });

  it("does not change the seasons it was given", () => {
    const before = JSON.stringify(one);
    combineSeasons([one, two]);
    expect(JSON.stringify(one)).toBe(before);
  });

  it("gives the club's record against other clubs, leaving derbies out", () => {
    expect(clubRecord(combineSeasons([one]))).toEqual({ w: 1, d: 1, l: 1, gf: 5, ga: 5, games: 3 });
  });

  it("ranks leaders, for the club or one team", () => {
    const period = combineSeasons([one]);
    expect(leaders(period.players, "goals")).toEqual([
      { key: "recP1", name: "Pat Player", value: 3, apps: 2, byTeam: [["HKFC A", 3]] },
      { key: "raw:old timer", name: "Old  TIMER", value: 1, apps: 1, byTeam: [["HKFC B", 1]] },
    ]);
    // Kim played one game each for A and B: the club list splits it, a team list keeps to its team.
    expect(leaders(period.players, "apps").find((r) => r.name === "Kim Keeper")).toMatchObject({ value: 2, byTeam: [["HKFC A", 1], ["HKFC B", 1]] });
    expect(leaders(period.players, "apps", { team: "HKFC B" }).find((r) => r.name === "Kim Keeper")).toMatchObject({ value: 1, byTeam: [["HKFC B", 1]] });
    expect(leaders(period.players, "apps", { team: "HKFC B" }).map((r) => r.name)).toEqual(["Sam Sub", "Kim Keeper", "Old  TIMER"]);
  });

  it("groups the teams by league, top league first", async () => {
    const { byLeague } = await import("../shared/clubStats");
    const teams = [
      { team: "HKFC B", leagues: { "1": { w: 2, d: 0, l: 1, gf: 5, ga: 3 } } },
      { team: "HKFC A", leagues: { P: { w: 3, d: 1, l: 0, gf: 9, ga: 2 }, "1": { w: 1, d: 0, l: 0, gf: 2, ga: 1 } } },
      { team: "HKFC H", leagues: { "5": { w: 0, d: 0, l: 2, gf: 1, ga: 6 } } },
    ] as any;
    expect(byLeague(teams).map((g) => [g.league, g.teams.map((t) => t.team)])).toEqual([
      ["P", ["HKFC A"]],
      ["1", ["HKFC A", "HKFC B"]],
      ["5", ["HKFC H"]],
    ]);
  });

  it("adds home, away and venue records across teams", () => {
    const s = splitsAcrossTeams(combineSeasons([one]).teams);
    expect(s.home).toEqual({ w: 2, d: 0, l: 1 });
    expect(s.away).toEqual({ w: 0, d: 1, l: 1 });
    expect(s.venues[0]).toEqual(["HKFC", { w: 2, d: 0, l: 2 }]);
  });
});

// ── Through the router ──────────────────────────────────────────────────

const ENV = {
  AIRTABLE_TOKEN: "***",
  AIRTABLE_BASE_ID: "appTest",
  CALENDAR_SECRET: "***",
  ALLOWED_ORIGIN: "https://app.test",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

function tables(): FakeTables {
  const m = (id: string, f: Record<string, unknown>) => ({ id, fields: { Season: "2025-2026", "Match Status": "Played", "Competition Type": "LEAGUE", Venue: "HKFC", Date: "2025-10-05T06:00:00.000Z", ...f } });
  return {
    People: [
      { id: "recPlayerPat00001", fields: { "Preferred Name": "Pat", Surname: "Player", Email: "pat@hkfc.com", Active: true, Status: "Member", "Match Cards": ["recCard000000001"] } },
      { id: "recPlayerKim00001", fields: { "Preferred Name": "Kim", Surname: "Keeper", Email: "kim@hkfc.com", Active: true, Status: "Member", "HKID No.": "A123456(7)", "Match Cards": ["recCard000000002"] } },
    ],
    Teams: [],
    Matches: [
      m("recMatch000000001", { "Home Team": "HKFC A", "Home Score": 3, "Away Team": "Valley A", "Away Score": 1, "Ump 1": "Appt - Alex Wong" }),
    ],
    "Match Cards": [
      { id: "recCard000000001", fields: { Match: ["recMatch000000001"], Player: ["recPlayerPat00001"], Team: "HKFC A", Season: ["2025-2026"], "Goals Scored": 2, Cards: ["Y2"] } },
      { id: "recCard000000002", fields: { Match: ["recMatch000000001"], Player: ["recPlayerKim00001"], Team: "HKFC A", Season: ["2025-2026"], Cards: ["Y1"] } },
    ],
  };
}

let handle: ReturnType<typeof fakeAirtable>;

beforeEach(() => {
  invalidateAll();
  resetMissingFieldCache();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-26T04:00:00Z"));
  handle = fakeAirtable(tables());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function as(email: string | null, path: string): Promise<Response> {
  const airtable = handle.fetchMock as unknown as typeof fetch;
  vi.stubGlobal("fetch", vi.fn((u: any, opts?: any) => {
    if (String(u).startsWith(ENV.SUPABASE_URL)) {
      return Promise.resolve(new Response(JSON.stringify({ email }), { status: 200 }));
    }
    return airtable(u, opts);
  }));
  const headers: Record<string, string> = { Origin: "https://app.test" };
  if (email) headers.Authorization = `Bearer token-for-${email}`;
  return worker.fetch(new Request(`https://api.test${path}`, { headers }), ENV, { waitUntil: () => {} } as any);
}

describe("the season route", () => {
  it("needs a sign-in", async () => {
    expect((await as(null, "/api/stats/season?season=2025-2026")).status).toBe(401);
  });

  it("sends the summary with the signed-in player's own cards and nobody else's", async () => {
    const res = await as("pat@hkfc.com", "/api/stats/season?season=2025-2026");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ season: "2025-2026", matches: 1, myCards: { yellow: 1, red: 0 } });
    expect(body.players.map((p: any) => p.name).sort()).toEqual(["Kim Keeper", "Pat Player"]);
    const text = JSON.stringify(body);
    expect(text).not.toContain("Y1");
    // Kim's yellow is nowhere: no card counts at all bar Pat's own.
    expect(text.match(/"yellow"/g)).toHaveLength(1);
    expect(text).not.toContain("A123456");
  });

  it("builds a past season once and serves it from the cache after", async () => {
    await as("pat@hkfc.com", "/api/stats/season?season=2025-2026");
    const reads = () => handle.calls.filter((c) => /\/(Matches|Match%20Cards)\?/.test(c.url)).length;
    const first = reads();
    await as("kim@hkfc.com", "/api/stats/season?season=2025-2026");
    expect(reads()).toBe(first);
  });

  it.each(["2025", "2025-2027", "2027-2028", "drop table"])("refuses the season %j", async (season) => {
    expect((await as("pat@hkfc.com", `/api/stats/season?season=${encodeURIComponent(season)}`)).status).toBe(400);
  });

  it("answers an empty season with nothing in it, so the page knows where history starts", async () => {
    const body = (await (await as("pat@hkfc.com", "/api/stats/season?season=2012-2013")).json()) as any;
    expect(body).toMatchObject({ matches: 0, teams: [], players: [] });
  });
});

describe("two players who share a name", () => {
  it("marks the younger (Jr), judged by date of birth", async () => {
    const { disambiguate } = await import("../worker/src/clubStats");
    expect(
      disambiguate(
        { recFather: "Shep Shepherdson", recSon: "Shep Shepherdson", recOther: "Pat Player" },
        { recFather: "John Michael", recSon: "Thomas", recOther: "Patrick" },
        { recFather: "1965-03-02", recSon: "1996-11-20" },
      ),
    ).toEqual({ recFather: "Shep Shepherdson", recSon: "Shep Shepherdson (Jr)", recOther: "Pat Player" });
  });

  it("falls back to given names in brackets without both birth dates", async () => {
    const { disambiguate } = await import("../worker/src/clubStats");
    expect(
      disambiguate(
        { recFather: "Shep Shepherdson", recSon: "Shep Shepherdson", recOther: "Pat Player" },
        { recFather: "John Michael", recSon: "Thomas", recOther: "Patrick" },
      ),
    ).toEqual({
      recFather: "Shep Shepherdson (John Michael)",
      recSon: "Shep Shepherdson (Thomas)",
      recOther: "Pat Player",
    });
  });
});
