import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Performance caches (evidence-based fixes):
//   - player-by-email (60s, auth bypasses via { fresh: true })
//   - scheduled-matches (10min, invalidated by syncSquad)
//   - availability:{matchId} poll cache (25s, invalidated by writes)
// ---------------------------------------------------------------------------

import { getPlayerByEmail, invalidatePlayerByEmail } from "../worker/src/reference";
import { getMyFixtures } from "../worker/src/fixtures";
import { getAvailabilityForMatch, syncSquad } from "../worker/src/squad";
import { setMyAvailability } from "../worker/src/availability";
import { invalidateAll } from "../src/lib/cache";

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
  const fetchMock = vi.fn((url: any, init?: any) => {
    const u = String(url);
    fetchCalls.push({ url: u, method: init?.method ?? "GET" });
    if (!u.includes("api.airtable.com")) return Promise.resolve(new Response("{}", { status: 404 }));
    const table = tableOf(u);
    let records: any[] = [];
    if (table === "People") {
      records = PLAYER_RECORDS;
      const q = new URLSearchParams(u.split("?")[1] ?? "");
      const formula = decodeURIComponent(q.get("filterByFormula") || "");
      const m = formula.match(/"([^"]+)"/);
      if (m) {
        const needle = m[1].toLowerCase();
        records = records.filter((r) => (r.fields?.["Email"] || "").toLowerCase() === needle);
      }
    } else if (table === "Teams") records = TEAM_RECORDS;
    else if (table === "Matches") records = MATCH_RECORDS;
    else if (table === "Availability Exceptions") records = EXCEPTION_RECORDS;
    else records = [];
    const byId = u.match(/\/rec[A-Z0-9]+/);
    if (byId) {
      const found = records.find((r) => u.includes(r.id));
      return Promise.resolve(
        new Response(JSON.stringify(found ?? { id: "x", fields: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    if ((init?.method ?? "GET") === "POST") {
      const body = JSON.parse(init.body ?? "{}");
      const created = (body.records ?? [body]).map((r: any, i: number) => ({ id: `recNew${i}`, fields: r.fields ?? r }));
      return Promise.resolve(
        new Response(JSON.stringify({ records: created }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ records }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as any;
  vi.stubGlobal("fetch", fetchMock);
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
    await getMyFixtures(ENV, "dave@hkfc.com");
    const afterFirst = matchesFetches();
    expect(afterFirst).toBe(1);
    await getMyFixtures(ENV, "dave@hkfc.com");
    expect(matchesFetches()).toBe(afterFirst);
  });

  it("is invalidated by syncSquad (selections live in match records)", async () => {
    await getMyFixtures(ENV, "dave@hkfc.com");
    const afterFirst = matchesFetches();
    // No newly-added players -> no eligibility revalidation, pure write path.
    await syncSquad(ENV, "recM1", ["recP2"], "coach@hkfc.com", "home");
    await getMyFixtures(ENV, "dave@hkfc.com");
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
    // read inside the write (season lookup) + the fresh post-write read
    expect(exceptionFetches()).toBe(afterRead + 2);
  });
});
