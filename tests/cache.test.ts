import { describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Performance caches (evidence-based fixes):
//   - player-by-email (60s cache; auth.ts uses it directly since B9)
//   - scheduled-matches (10min, invalidated by syncSquad)
//   - availability:{matchId} poll cache (25s, invalidated by writes)
//
// Through the in-memory repositories: "a read reached the database" is a
// call to the repository method behind it. All of these caches are
// per-isolate (getShared keeps only the Stats summaries in KV), so no CACHE
// binding is needed.
// ---------------------------------------------------------------------------

import {
  getPlayerByEmail,
  invalidatePlayerByEmail,
  getExceptionsForSeasons,
} from "../worker/src/reference";
import { getMyFixtures } from "../worker/src/fixtures";
import { getAvailabilityForMatch, syncSquad } from "../worker/src/squad";
import { setMyAvailability } from "../worker/src/availability";
import { invalidateAll, invalidateCache, getCached } from "../worker/src/cache";
import { newRequestStats, runWithRequestContext } from "../worker/src/requestContext";
import type { AuthorizedUser } from "../worker/src/auth";
import type { Env } from "../worker/src/env";
import type { ExceptionChanges } from "../worker/src/data/availabilityExceptions";
import { useFakeRepos } from "./helpers/fakeRepos";
import { fakePostgrest, SUPABASE_TEST_ENV } from "./helpers/postgrest";
import { exception, match, person, recId, team, signedIn } from "./helpers/factories";

function authUser(email: string): AuthorizedUser {
  return signedIn({ email, personId: "", role: "player", coachTeams: [], isSectionCaptain: false, officerRoles: [] });
}

const ENV = {
  ...SUPABASE_TEST_ENV,
  CALENDAR_SECRET: "***",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as unknown as Env;

const BOB = recId("P2");
const DAVE = recId("P4");
const ERIN = recId("P5");
const TWIN_STALE = recId("TwinStale");
const TWIN_ACTIVE = recId("TwinActive");
const M1 = recId("M1");
const M4 = recId("M4");
const E1 = recId("E1");

const db = useFakeRepos(() => ({
  teams: ["A", "B", "C", "D", "E", "F", "G", "H"].map((n, i) =>
    team({ id: recId(`T${i}`), teamName: n, teamRank: i + 1, active: true, targetSquadSize: 14 }),
  ),
  people: [
    person({ id: BOB, preferredName: "Bob", surname: "B", email: "bob@hkfc.com", registeredTeam: "H", playingPosition: "Goalkeeper", playingAbility: "H", status: "Active" }),
    person({ id: DAVE, preferredName: "Dave", surname: "D", email: "dave@hkfc.com", registeredTeam: "A", playingPosition: "Defender", playingAbility: "A", status: "Active" }),
    // Email stored with capitals. The lookup must lowercase both sides
    // (api_players.email_lower on Supabase) to reach this record.
    person({ id: ERIN, preferredName: "Erin", surname: "E", email: "Erin.Capital@HKFC.com", registeredTeam: "A", playingPosition: "Midfielder", playingAbility: "B", status: "Active" }),
    // A stale duplicate ahead of the live record for the same address. Ordered
    // inactive-first on purpose: taking rows[0] would refuse this person.
    // (Postgres keeps emails unique, so on Supabase this is the repository's
    // defensive preference rather than a case production can produce.)
    person({ id: TWIN_STALE, preferredName: "Twin", surname: "T", email: "twin@hkfc.com", active: false, registeredTeam: "A", playingPosition: "Forward", playingAbility: "C", status: "Inactive" }),
    person({ id: TWIN_ACTIVE, preferredName: "Twin", surname: "T", email: "twin@hkfc.com", registeredTeam: "A", playingPosition: "Forward", playingAbility: "C", status: "Active" }),
  ],
  matches: [
    match({ id: M1, matchDate: "2026-08-22T10:00:00.000Z", season: "2026-27", division: "Div 1", homeTeam: "A", awayTeam: "Valley A", venue: "P1", matchStatus: "Scheduled", selectedPlayersHome: [BOB], selectedPlayersAway: [] }),
    match({ id: M4, matchDate: "2026-08-29T09:00:00.000Z", season: "2026-27", division: "Div 1", homeTeam: "A", awayTeam: "B", venue: "P1", matchStatus: "Scheduled", selectedPlayersHome: [], selectedPlayersAway: [BOB] }),
  ],
  availabilityExceptions: [
    exception({ id: E1, player: [BOB], match: [M4], availabilityStatus: "Maybe", note: "Work", season: "2026-27" }),
  ],
}));

const peopleFetches = () => db.callsTo("people", "findByEmail").length;
const matchesFetches = () => db.callsTo("matches", "listScheduled").length;
/** Reads of availability answers of any shape: a season's, some matches', or one player's. */
const exceptionFetches = () => db.callsTo("availabilityExceptions").filter((c) => c.method.startsWith("list")).length;

beforeEach(() => {
  invalidateAll();
  // The player dashboard also asks Supabase directly whether this player
  // keeps volunteers, events or umpiring duties (volunteerAccess.ts,
  // eventAccess.ts, umpiring.ts). None of them: every table is empty.
  fakePostgrest({
    tables: { api_offices: [], people: [], offices: [], team_people: [], matches: [], umpire_assignments: [] },
  });
});

describe("player-by-email cache", () => {
  it("reuses the cached People record within the TTL", async () => {
    const a = await getPlayerByEmail(ENV, "dave@hkfc.com");
    expect(a?.id).toBe(DAVE);
    const callsAfterFirst = peopleFetches();
    const b = await getPlayerByEmail(ENV, "dave@hkfc.com");
    expect(b?.id).toBe(DAVE);
    expect(peopleFetches()).toBe(callsAfterFirst);
  });

  it("normalizes email case/whitespace for the cache key", async () => {
    await getPlayerByEmail(ENV, "  DAVE@HKFC.com ");
    const before = peopleFetches();
    await getPlayerByEmail(ENV, "dave@hkfc.com");
    expect(peopleFetches()).toBe(before);
  });

  // Regression: the lookup sent {Email}="..." against an already-lowercased
  // address. Airtable compared text case-sensitively, so every People record
  // whose Email held a capital letter failed to match and that person was
  // refused access as though they were not in the club at all.
  it("finds a People record whose Email is stored with capital letters", async () => {
    const found = await getPlayerByEmail(ENV, "erin.capital@hkfc.com");
    expect(found?.id).toBe(ERIN);
  });

  // The match is case-insensitive on both sides, so it cannot depend on the
  // caller having normalized first. auth.ts does; other callers need not.
  it("matches whatever case the caller passes, against whatever case is stored", async () => {
    for (const query of ["ERIN.CAPITAL@HKFC.COM", "Erin.Capital@HKFC.com", " erin.CAPITAL@hkfc.com "]) {
      invalidatePlayerByEmail(query);
      expect((await getPlayerByEmail(ENV, query))?.id).toBe(ERIN);
    }
  });

  // Regression: a stale duplicate row returned ahead of the live one decided
  // the person's access, so they were refused while the record the
  // administrator was editing plainly said Active.
  it("prefers the active record when duplicates share an email", async () => {
    const found = await getPlayerByEmail(ENV, "twin@hkfc.com");
    expect(found?.id).toBe(TWIN_ACTIVE);
  });

  it("bypasses the cache with { fresh: true } (authorization path)", async () => {
    await getPlayerByEmail(ENV, "dave@hkfc.com");
    const before = peopleFetches();
    await getPlayerByEmail(ENV, "dave@hkfc.com", { fresh: true });
    expect(peopleFetches()).toBe(before + 1);
  });

  it("invalidates on demand", async () => {
    await getPlayerByEmail(ENV, "dave@hkfc.com");
    const before = peopleFetches();
    invalidatePlayerByEmail("dave@hkfc.com");
    await getPlayerByEmail(ENV, "dave@hkfc.com");
    expect(peopleFetches()).toBe(before + 1);
  });
});

describe("scheduled-matches cache", () => {
  it("fetches Scheduled matches once across repeated fixture loads", async () => {
    await getMyFixtures(ENV, authUser("dave@hkfc.com"));
    const afterFirst = matchesFetches();
    expect(afterFirst).toBe(1);
    await getMyFixtures(ENV, authUser("dave@hkfc.com"));
    expect(matchesFetches()).toBe(afterFirst);
  });

  it("is refetched after syncSquad (selections live in match records), in every isolate", async () => {
    // Each call is its own request, reading the cache versions as the Worker does.
    const request = <T>(fn: () => Promise<T>) => runWithRequestContext({ stats: newRequestStats() }, fn);
    await request(() => getMyFixtures(ENV, authUser("dave@hkfc.com")));
    const afterFirst = matchesFetches();
    await request(() => getMyFixtures(ENV, authUser("dave@hkfc.com")));
    expect(matchesFetches()).toBe(afterFirst); // same versions: cached
    // No newly-added players -> no eligibility revalidation, pure write path.
    await request(() => syncSquad(ENV, M1, [BOB], "coach@hkfc.com", "home"));
    await request(() => getMyFixtures(ENV, authUser("dave@hkfc.com")));
    // The save moved the versions: no invalidation needed, the key changed.
    expect(matchesFetches()).toBeGreaterThan(afterFirst);
  });
});

describe("the player's own answers on the dashboard", () => {
  // Read past the cache on every load before (173 KB a request on preview);
  // now kept under the availability_exceptions version, which a tap moves.
  it("are read once while nobody answers, and again after a tap, so the player sees it", async () => {
    const request = <T>(fn: () => Promise<T>) => runWithRequestContext({ stats: newRequestStats() }, fn);
    const dave = () => db.signedIn("dave@hkfc.com");
    const M5 = recId("M5");
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    db.state.matches.push(match({ id: M5, matchDate: soon, season: "2026-27", division: "Div 1", homeTeam: "A", awayTeam: "Valley B", venue: "P1", matchStatus: "Scheduled" }));
    await request(() => getMyFixtures(ENV, dave()));
    const afterFirst = exceptionFetches();
    expect(afterFirst).toBeGreaterThan(0);
    await request(() => getMyFixtures(ENV, dave()));
    expect(exceptionFetches()).toBe(afterFirst);

    await request(() => setMyAvailability(ENV, { email: "dave@hkfc.com", matchId: M5, status: "Unavailable" }));
    const before = exceptionFetches();
    const out = await request(() => getMyFixtures(ENV, dave()));
    expect(exceptionFetches()).toBeGreaterThan(before);
    expect(JSON.stringify(out)).toContain("Unavailable");
  });
});

describe("availability poll cache", () => {
  it("serves repeated polls from the 25s cache (zero database calls)", async () => {
    const r1 = await getAvailabilityForMatch(ENV, M4);
    expect(r1.exceptions).toHaveLength(1);
    expect(r1.exceptions[0]).toMatchObject({ playerId: BOB, status: "Maybe" });
    const afterFirst = exceptionFetches();
    const r2 = await getAvailabilityForMatch(ENV, M4);
    expect(r2.exceptions).toHaveLength(1);
    expect(exceptionFetches()).toBe(afterFirst);
  });

  it("is invalidated by an availability write so the next poll is fresh", async () => {
    await getAvailabilityForMatch(ENV, M4);
    const afterRead = exceptionFetches();
    await setMyAvailability(ENV, { email: "bob@hkfc.com", matchId: M4, status: "Unavailable" });
    await getAvailabilityForMatch(ENV, M4);
    // Two extra reads, both deliberate. The write's own lookup no longer
    // shares the warm per-season index: it is a read-modify-write, and
    // reading a cached snapshot meant a delete could silently target a
    // record that was not in it. Then the invalidated post-write read goes
    // to the database again.
    expect(exceptionFetches()).toBe(afterRead + 2);
  });
});

describe("getCached in-flight de-dup", () => {
  it("shares one fetcher() call across concurrent cold misses for the same key", async () => {
    let calls = 0;
    const fetcher = () =>
      new Promise<string>((resolve) => {
        calls++;
        setTimeout(() => resolve("value"), 10);
      });

    const [a, b, c] = await Promise.all([
      getCached("dedup-key", fetcher),
      getCached("dedup-key", fetcher),
      getCached("dedup-key", fetcher),
    ]);

    expect(calls).toBe(1);
    expect(a.data).toBe("value");
    expect(b.data).toBe("value");
    expect(c.data).toBe("value");
    // The originator reports a real miss; concurrent joiners share its result.
    expect([a.fromCache, b.fromCache, c.fromCache].filter((f) => f === false)).toHaveLength(1);
  });

  it("still calls fetcher() again for a second, independent miss after the first resolves", async () => {
    let calls = 0;
    const fetcher = () => {
      calls++;
      return Promise.resolve(`value-${calls}`);
    };

    const first = await getCached("dedup-key-2", fetcher, 0); // ttl 0 -> expires immediately
    const second = await getCached("dedup-key-2", fetcher, 0);

    expect(calls).toBe(2);
    expect(first.data).toBe("value-1");
    expect(second.data).toBe("value-2");
  });

  it("does not let a stale in-flight fetch clobber a fresher one that started after invalidateCache", async () => {
    // Deferred, manually-resolved promises so the test controls resolution
    // order explicitly rather than trusting timer scheduling: the STALE
    // fetch (started before invalidation) resolves LAST, after the fresh
    // one - the worst case for a naive "last write wins" cache.
    const deferred: { resolve: (v: string) => void }[] = [];
    const fetcher = () =>
      new Promise<string>((resolve) => {
        deferred.push({ resolve });
      });

    const stale = getCached("dedup-key-3", fetcher); // call #1, starts the in-flight fetch
    invalidateCache("dedup-key-3");
    const fresh = getCached("dedup-key-3", fetcher); // call #2, must NOT join call #1

    expect(deferred).toHaveLength(2);
    // Resolve the FRESH fetch first, then the STALE one - the dangerous
    // order for a naive "last write wins" cache, since the stale write
    // would otherwise land last and clobber the fresh value.
    deferred[1].resolve("fresh-value");
    deferred[0].resolve("stale-value");
    await Promise.all([stale, fresh]);

    // Whichever order they settle in, the cache must end up holding the
    // fresh fetch's result, not the stale one's.
    const { data, fromCache } = await getCached("dedup-key-3", async () => "should-not-be-called");
    expect(data).toBe("fresh-value");
    expect(fromCache).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Availability exceptions: cached for the aggregate views, read fresh where a
// player is looking at their own answer.
//
// The cache lives in one Worker isolate's memory and Cloudflare runs many, so
// a write only clears it where the write happened. Landing on another isolate
// served a five-minute-old copy that put the player's previous status back -
// which is what "I can't change my availability" actually was. Invalidation
// cannot fix that; only not caching the read can.
// ---------------------------------------------------------------------------

describe("availability exceptions freshness", () => {
  const SEASON = ["2026-27"];

  it("serves a repeat read from the cache by default", async () => {
    await getExceptionsForSeasons(ENV, SEASON);
    const before = exceptionFetches();
    await getExceptionsForSeasons(ENV, SEASON);
    expect(exceptionFetches()).toBe(before);
  });

  it("goes back to the database with { fresh: true }", async () => {
    await getExceptionsForSeasons(ENV, SEASON);
    const before = exceptionFetches();
    await getExceptionsForSeasons(ENV, SEASON, { fresh: true });
    expect(exceptionFetches()).toBe(before + 1);
  });

  it("returns the same data either way", async () => {
    const cached = await getExceptionsForSeasons(ENV, SEASON);
    const fresh = await getExceptionsForSeasons(ENV, SEASON, { fresh: true });
    expect(fresh.map((e) => e.id)).toEqual(cached.map((e) => e.id));
  });

  // A fresh read must not prime the cache for everyone else, or one player's
  // dashboard would silently extend the staleness window for the rest.
  it("does not write its result into the cache", async () => {
    await getExceptionsForSeasons(ENV, SEASON, { fresh: true });
    const before = exceptionFetches();
    await getExceptionsForSeasons(ENV, SEASON);
    expect(exceptionFetches()).toBe(before + 1);
  });
});

// ---------------------------------------------------------------------------
// The availability write is a read-modify-write, so it must never consult the
// cache. Setting yourself Available deletes the exception, and the delete only
// happens if the lookup can see the record. The cache is per-isolate, so an
// exception written moments ago elsewhere is simply absent - nothing is
// deleted, success is still reported, and the player stays Unavailable however
// many times they tap.
// ---------------------------------------------------------------------------

describe("availability writes read past the cache", () => {
  /** Every change set the write sent (one apply_availability_changes call each on Supabase). */
  const applied = () => db.callsTo("availabilityExceptions", "apply").map((c) => c.args[0] as ExceptionChanges);
  const deleteCalls = () => applied().filter((c) => c.deleteIds.length > 0).length;
  const createCalls = () => applied().reduce((n, c) => n + c.creates.length, 0);

  /** An exception this isolate's cache has never seen, as if written elsewhere. */
  const addExceptionElsewhere = (id: string, matchId: string) => {
    db.state.availabilityExceptions.push(
      exception({ id, player: [DAVE], match: [matchId], availabilityStatus: "Unavailable", note: "", season: "2026-27" }),
    );
  };

  it("deletes an exception the cache never saw, instead of silently doing nothing", async () => {
    const STALE1 = recId("Stale1");
    // Warm the cache BEFORE the exception exists - the stale snapshot.
    await getExceptionsForSeasons(ENV, ["2026-27"]);
    addExceptionElsewhere(STALE1, M1);
    await setMyAvailability(ENV, {
      email: "dave@hkfc.com",
      matchId: M1,
      status: "Available",
    });
    expect(deleteCalls()).toBe(1);
    // The id must actually reach the database. Asserting only that a delete
    // happened is what let an Airtable batch delete with an empty query
    // string - rejected every single time - pass as working.
    const deleted = applied().find((c) => c.deleteIds.length > 0)!.deleteIds;
    expect(deleted).toContain(STALE1);
    // And the record is gone, not merely asked about.
    expect(db.state.availabilityExceptions.some((e) => e.id === STALE1)).toBe(false);
  });

  it("updates that exception rather than writing a duplicate", async () => {
    const STALE2 = recId("Stale2");
    await getExceptionsForSeasons(ENV, ["2026-27"]);
    addExceptionElsewhere(STALE2, M1);
    const createsBefore = createCalls();
    await setMyAvailability(ENV, {
      email: "dave@hkfc.com",
      matchId: M1,
      status: "Maybe",
    });
    // A second row for the same player and match is a data problem, not
    // just a display one: two answers, and whichever is read first wins.
    expect(createCalls()).toBe(createsBefore);
  });
});
