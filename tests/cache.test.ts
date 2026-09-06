import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Performance caches (evidence-based fixes):
//   - player-by-email (60s cache; auth.ts uses it directly since B9)
//   - scheduled-matches (10min, invalidated by syncSquad)
//   - availability:{matchId} poll cache (25s, invalidated by writes)
// ---------------------------------------------------------------------------

import { getPlayerByEmail, invalidatePlayerByEmail } from "../worker/src/reference";
import { getMyFixtures } from "../worker/src/fixtures";
import { getAvailabilityForMatch, syncSquad } from "../worker/src/squad";
import { setMyAvailability } from "../worker/src/availability";
import { invalidateAll, invalidateCache, getCached } from "../worker/src/cache";
import type { AuthorizedUser } from "../worker/src/auth";
import { fakeAirtable, type FakeTables } from "./helpers/airtable";

function authUser(email: string): AuthorizedUser {
  return { email, personId: "", role: "player", coachTeams: [], isSectionCaptain: false };
}

const ENV = {
  AIRTABLE_TOKEN: "***",
  AIRTABLE_BASE_ID: "test-base",
  CALENDAR_SECRET: "***",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

const TEAM_RECORDS = ["A", "B", "C", "D", "E", "F", "G", "H"].map((n, i) => ({
  id: `recT${i}`,
  fields: { "Team Name": n, "Team Rank": i + 1, Active: true, "Target Squad Size": 14 },
}));

const PLAYER_RECORDS = [
  { id: "recP2", fields: { "Preferred Name": "Bob", Surname: "B", Email: "bob@hkfc.com", Active: true, "Registered Team": "H", "Playing Position": "Goalkeeper", "Playing Ability": "H", Status: "Active" } },
  { id: "recP4", fields: { "Preferred Name": "Dave", Surname: "D", Email: "dave@hkfc.com", Active: true, "Registered Team": "A", "Playing Position": "Defender", "Playing Ability": "A", Status: "Active" } },
];

const MATCH_RECORDS = [
  { id: "recM1", fields: { Date: "2026-08-22T10:00:00.000Z", Season: "2026-27", Division: "Div 1", "Home Team": "A", "Away Team": "Valley A", Venue: "P1", "Match Status": "Scheduled", "Selected Players Home": ["recP2"], "Selected Players Away": [] } },
  { id: "recM4", fields: { Date: "2026-08-29T09:00:00.000Z", Season: "2026-27", Division: "Div 1", "Home Team": "A", "Away Team": "B", Venue: "P1", "Match Status": "Scheduled", "Selected Players Home": [], "Selected Players Away": ["recP2"] } },
];

const EXCEPTION_RECORDS = [
  { id: "recE1", fields: { Player: ["recP2"], Match: ["recM4"], "Availability Status": "Maybe", "Player Notes": "Work", "Season (Matches)": "2026-27" } },
];

let fetchCalls: { url: string; method: string }[] = [];

function tableOf(u: string): string {
  return decodeURIComponent((u.match(/\/v0\/[^/]+\/([^/?]+)/) ?? [])[1] ?? "");
}

function installFakeAirtable() {
  const tables: FakeTables = {
    People: PLAYER_RECORDS,
    Teams: TEAM_RECORDS,
    Matches: MATCH_RECORDS,
    "Availability Exceptions": EXCEPTION_RECORDS,
  };
  const { calls } = fakeAirtable(tables);
  fetchCalls = calls;
}

const peopleFetches = () =>
  fetchCalls.filter((c) => c.method === "GET" && tableOf(c.url) === "People").length;
const matchesFetches = () =>
  fetchCalls.filter((c) => c.method === "GET" && tableOf(c.url) === "Matches").length;
const exceptionFetches = () =>
  fetchCalls.filter((c) => c.method === "GET" && tableOf(c.url) === "Availability Exceptions").length;

beforeEach(() => {
  invalidateAll();
  fetchCalls = [];
  installFakeAirtable();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("player-by-email cache", () => {
  it("reuses the cached People record within the TTL", async () => {
    const a = await getPlayerByEmail(ENV, "dave@hkfc.com");
    expect(a?.id).toBe("recP4");
    const callsAfterFirst = peopleFetches();
    const b = await getPlayerByEmail(ENV, "dave@hkfc.com");
    expect(b?.id).toBe("recP4");
    expect(peopleFetches()).toBe(callsAfterFirst);
  });

  it("normalizes email case/whitespace for the cache key", async () => {
    await getPlayerByEmail(ENV, "  DAVE@HKFC.com ");
    const before = peopleFetches();
    await getPlayerByEmail(ENV, "dave@hkfc.com");
    expect(peopleFetches()).toBe(before);
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

  it("is invalidated by syncSquad (selections live in match records)", async () => {
    await getMyFixtures(ENV, authUser("dave@hkfc.com"));
    const afterFirst = matchesFetches();
    // No newly-added players -> no eligibility revalidation, pure write path.
    await syncSquad(ENV, "recM1", ["recP2"], "coach@hkfc.com", "home");
    await getMyFixtures(ENV, authUser("dave@hkfc.com"));
    expect(matchesFetches()).toBeGreaterThan(afterFirst); // refetched after invalidation
  });
});

describe("availability poll cache", () => {
  it("serves repeated polls from the 25s cache (zero Airtable calls)", async () => {
    const r1 = await getAvailabilityForMatch(ENV, "recM4");
    expect(r1.exceptions).toHaveLength(1);
    expect(r1.exceptions[0]).toMatchObject({ playerId: "recP2", status: "Maybe" });
    const afterFirst = exceptionFetches();
    const r2 = await getAvailabilityForMatch(ENV, "recM4");
    expect(r2.exceptions).toHaveLength(1);
    expect(exceptionFetches()).toBe(afterFirst);
  });

  it("is invalidated by an availability write so the next poll is fresh", async () => {
    await getAvailabilityForMatch(ENV, "recM4");
    const afterRead = exceptionFetches();
    await setMyAvailability(ENV, { email: "bob@hkfc.com", matchId: "recM4", status: "Unavailable" });
    await getAvailabilityForMatch(ENV, "recM4");
    // The write's own exception lookup shares the same cached per-season
    // index as the read above (warm, zero extra fetches) - only the
    // invalidated post-write read hits Airtable again.
    expect(exceptionFetches()).toBe(afterRead + 1);
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
