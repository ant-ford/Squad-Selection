import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Availability reads ask for what the screen shows, not the season.
//
// Every one of these used to read the whole season's answers
// (api_availability_exceptions?season=..., 905 rows / ~177 KB on preview) and
// filter them in the Worker - my-fixtures on EVERY request, uncached, so a
// player saw their own tap. Now:
//
//   my-fixtures          the player's own answers: player=eq & match=in.(cards)
//   calendar feed        the cards' answers (it names the squad): match=in.(cards)
//   coach fixture list   the listed fixtures' answers: match=in.(fixtures)
//   30 s poll            one match: match=in.(id)
//   players-for-match    the poll's read, shared with the poll's cache
//
// with narrow columns (id, player, match, status, note).
// ---------------------------------------------------------------------------

import { getMyFixtures, getPlayerFixtures, getUpcomingFixtures } from "../worker/src/fixtures";
import { getAvailabilityForMatch, getPlayersForMatch } from "../worker/src/squad";
import { availabilityExceptions } from "../worker/src/data/availabilityExceptions";
import { invalidateAll } from "../worker/src/cache";
import { newRequestStats, runWithRequestContext } from "../worker/src/requestContext";
import { parseCacheVersions } from "../worker/src/cacheVersions";
import type { AuthorizedUser } from "../worker/src/auth";
import { useFakeRepos } from "./helpers/fakeRepos";
import { fakePostgrest, SUPABASE_TEST_ENV } from "./helpers/postgrest";
import { exception, match, person, recId, team } from "./helpers/factories";

const ENV = {
  ...SUPABASE_TEST_ENV,
  CALENDAR_SECRET: "***",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

const futureIso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const BOB = recId("Bob");
const DAVE = recId("Dave");
const M1 = recId("M1");
const M4 = recId("M4");
const M6 = recId("M6");
const ELSEWHERE = recId("Elsewhere");

describe("availability reads through the repositories", () => {
  /** Signed in as auth.ts builds it (auth_context), from the fakes' state. */
  const user = (email: string, extra: Partial<AuthorizedUser> = {}): AuthorizedUser => db.signedIn(email, extra);
  const db = useFakeRepos(() => ({
    teams: ["A", "B", "C", "D", "E", "F", "G", "H"].map((n, i) =>
      team({ id: recId(`T${i}`), teamName: n, teamRank: i + 1, active: true, targetSquadSize: 14 }),
    ),
    people: [
      person({ id: BOB, preferredName: "Bob", surname: "B", email: "bob@hkfc.com", registeredTeam: "A", selectedTeamEos: "A", playingPosition: "Forward", playingAbility: "B", status: "Active" }),
      person({ id: DAVE, preferredName: "Dave", surname: "D", email: "dave@hkfc.com", registeredTeam: "A", selectedTeamEos: "A", playingPosition: "Defender", playingAbility: "A", status: "Active" }),
    ],
    matches: [
      match({ id: M1, matchDate: futureIso(3), season: "2026-2027", homeTeam: "A", awayTeam: "Valley A", matchStatus: "Scheduled", selectedPlayersHome: [BOB, DAVE] }),
      match({ id: M4, matchDate: futureIso(10), season: "2026-2027", homeTeam: "A", awayTeam: "Valley B", matchStatus: "Scheduled" }),
      // Nothing to do with HKFC: never asked about.
      match({ id: M6, matchDate: futureIso(5), season: "2026-2027", homeTeam: "Valley C", awayTeam: "Valley D", matchStatus: "Scheduled" }),
    ],
    availabilityExceptions: [
      exception({ id: recId("E1"), player: [BOB], match: [M1], availabilityStatus: "Maybe", note: "Late", season: "2026-2027" }),
      exception({ id: recId("E2"), player: [BOB], match: [M4], availabilityStatus: "Unavailable", note: "Work", season: "2026-2027" }),
      exception({ id: recId("E3"), player: [DAVE], match: [M6], availabilityStatus: "Unavailable", season: "2026-2027" }),
    ],
  }));

  beforeEach(() => {
    invalidateAll();
    fakePostgrest({
      tables: { api_offices: [], people: [], offices: [], team_people: [], matches: [], umpire_assignments: [] },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const calls = (method: string) => db.callsTo("availabilityExceptions", method);

  it("my-fixtures reads only the player's own answers for their cards, exact under the cache versions", async () => {
    // As index.ts runs a request: the versions come from the (fake) database.
    const request = <T>(fn: () => Promise<T>) => runWithRequestContext({ stats: newRequestStats() }, fn);
    const first = await request(() => getMyFixtures(ENV, user("bob@hkfc.com")));
    expect(first.fixtures.map((f: any) => [f.id, f.availabilityStatus, f.playerNotes])).toEqual([
      [M1, "Maybe", "Late"],
      [M4, "Unavailable", "Work"],
    ]);
    expect(calls("listForSeasons")).toHaveLength(0);
    expect(calls("listForMatches")).toHaveLength(0);
    expect(calls("listForPlayer").map((c) => c.args)).toEqual([[BOB, [M1, M4].sort()]]);

    // While the versions stand, the next request reads nothing.
    await request(() => getMyFixtures(ENV, user("bob@hkfc.com")));
    expect(calls("listForPlayer")).toHaveLength(1);

    // An answer written on another isolate moves the version (the fakes move
    // every counter on any repository write), and shows on the next request.
    db.state.availabilityExceptions[0].availabilityStatus = "Unavailable";
    await db.repos.people.update(DAVE, { playingAbility: "A" });
    const third = await request(() => getMyFixtures(ENV, user("bob@hkfc.com")));
    expect(third.fixtures[0].availabilityStatus).toBe("Unavailable");
    expect(calls("listForPlayer")).toHaveLength(2);
  });

  it("the calendar feed reads its cards' answers once, for the squad as well", async () => {
    const out = await getPlayerFixtures(ENV, DAVE);
    const m1 = out.fixtures.find((f: any) => f.id === M1)!;
    expect(m1.squad.map((s: any) => [s.name, s.availabilityStatus])).toEqual([["Bob", "Maybe"], ["Dave", ""]]);
    expect(calls("listForSeasons")).toHaveLength(0);
    expect(calls("listForMatches").map((c) => c.args)).toEqual([[[M1, M4].sort()]]);
  });

  it("the coach fixture list reads the answers of its fixtures only", async () => {
    const out = await getUpcomingFixtures(ENV, { user: user("coach@hkfc.com", { role: "coach", coachTeams: ["A"] }) });
    expect(out.fixtures.map((f: any) => f.id)).toEqual([M1, M4]);
    const m4 = out.fixtures.find((f: any) => f.id === M4) as any;
    expect(m4.unavailableNames).toEqual(["Bob"]);
    expect(calls("listForSeasons")).toHaveLength(0);
    expect(calls("listForMatches").map((c) => c.args)).toEqual([[[M1, M4].sort()]]);
  });

  it("the 30 s poll reads that one match", async () => {
    const out = await getAvailabilityForMatch(ENV, M4);
    expect(out.exceptions).toEqual([{ playerId: BOB, status: "Unavailable", notes: "Work" }]);
    expect(calls("listForMatches").map((c) => c.args)).toEqual([[[M4]]]);
    expect(calls("listForSeasons")).toHaveLength(0);
    expect(db.callsTo("matches", "getById")).toHaveLength(0);
  });

  it("players-for-match takes its answers and notes from the poll's read, and shares its cache", async () => {
    const out = await getPlayersForMatch(ENV, M4, "home");
    const bob = out.players.find((p: any) => p.id === BOB)!;
    expect([bob.availabilityStatus, bob.playerNotes]).toEqual(["Unavailable", "Work"]);
    const dave = out.players.find((p: any) => p.id === DAVE)!;
    expect([dave.availabilityStatus, dave.playerNotes]).toEqual(["Available", ""]);
    expect(calls("listForMatches").map((c) => c.args)).toEqual([[[M4]]]);
    // The coach's page then polls: no further read for 25 s.
    await getAvailabilityForMatch(ENV, M4);
    expect(calls("listForMatches")).toHaveLength(1);
    // An answer from another isolate written since is not hidden behind the
    // season context's cache: a fresh poll read picks it up for both.
    db.state.availabilityExceptions.push(
      exception({ id: ELSEWHERE, player: [DAVE], match: [M4], availabilityStatus: "Maybe", note: "Flight", season: "2026-2027" }),
    );
    invalidateAll();
    const again = await getPlayersForMatch(ENV, M4, "home");
    expect(again.players.find((p: any) => p.id === DAVE)).toMatchObject({ availabilityStatus: "Maybe", playerNotes: "Flight" });
  });
});

describe("what the targeted reads send to PostgREST", () => {
  /** One signed-in request: sign-in (auth_context) hands it the cache versions, so no read of its own. */
  const counted = async <T>(fn: () => Promise<T>) => {
    const stats = newRequestStats();
    const out = await runWithRequestContext({ stats, versions: parseCacheVersions({}) }, fn);
    return { out, stats };
  };
  afterEach(() => vi.unstubAllGlobals());

  it("asks for one match's answers with narrow columns, in one call", async () => {
    const pg = fakePostgrest({
      tables: {
        api_availability_exceptions: [
          { id: "e1", player: BOB, match: M4, availability_status: "Unavailable", note: "Work", season: "2026-2027", updated_at: "x" },
          { id: "e2", player: DAVE, match: M1, availability_status: "Maybe", note: null, season: "2026-2027", updated_at: "x" },
        ],
      },
    });
    invalidateAll();
    const { out, stats } = await counted(() => getAvailabilityForMatch(ENV, M4));
    expect(out.exceptions).toEqual([{ playerId: BOB, status: "Unavailable", notes: "Work" }]);
    expect(stats.dbCalls).toBe(1);
    expect(stats.dbBytes).toBeLessThan(200);
    const [read] = pg.reads("api_availability_exceptions");
    expect(read.params.get("select")).toBe("id,player,match,availability_status,note");
    expect(read.params.get("match")).toBe(`in.("${M4}")`);
    expect(read.params.has("season")).toBe(false);
  });

  it("asks for one player's answers by player and match", async () => {
    const pg = fakePostgrest({
      tables: {
        api_availability_exceptions: [
          { id: "e1", player: BOB, match: M4, availability_status: "Unavailable", note: "Work" },
          { id: "e2", player: DAVE, match: M4, availability_status: "Maybe", note: null },
        ],
      },
    });
    const rows = await availabilityExceptions(ENV).listForPlayer(BOB, [M1, M4]);
    expect(rows.map((r) => r.id)).toEqual(["e1"]);
    expect(pg.reads("api_availability_exceptions")[0].params.get("player")).toBe(`eq.${BOB}`);
  });

  it("splits a long fixture list into reads of 100 matches, in parallel", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => recId(`X${String(i).padStart(3, "0")}`));
    const pg = fakePostgrest({ tables: { api_availability_exceptions: [] } });
    await availabilityExceptions(ENV).listForMatches(ids);
    const reads = pg.reads("api_availability_exceptions");
    expect(reads).toHaveLength(2);
    expect(reads.map((r) => r.params.get("match")!.split(",").length)).toEqual([100, 50]);
  });

  it("asks nothing for no matches", async () => {
    const pg = fakePostgrest({ tables: {} });
    expect(await availabilityExceptions(ENV).listForMatches([])).toEqual([]);
    expect(await availabilityExceptions(ENV).listForPlayer(BOB, [])).toEqual([]);
    expect(pg.calls).toHaveLength(0);
  });
});

