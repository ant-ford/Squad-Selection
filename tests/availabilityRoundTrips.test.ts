import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// What an availability tap costs on the wire.
//
// Before set_availability a tap was about six sequential round trips: the
// player, the Scheduled matches, every answer of the season read fresh
// (~177 KB on preview), the rules, the reference data (~150 KB), then the
// write - 100 to 360 KB, and racy across isolates. Now it is the one RPC
// after sign-in (whose People lookup the tap reuses), a few hundred bytes.
// Counted with the Worker's own per-request counters (requestContext.ts),
// through the real Supabase repositories against a fake PostgREST.
// ---------------------------------------------------------------------------

import { setMyAvailability, setMyAvailabilityForDate, setPlayerAvailability } from "../worker/src/availability";
import { getPlayerByEmail } from "../worker/src/reference";
import { invalidateAll } from "../worker/src/cache";
import { newRequestStats, runWithRequestContext, type RequestStats } from "../worker/src/requestContext";
import { fakePostgrest, SUPABASE_TEST_ENV, type FakePostgrest } from "./helpers/postgrest";
import { recId } from "./helpers/factories";
import { parseCacheVersions } from "../worker/src/cacheVersions";

const ENV = { ...SUPABASE_TEST_ENV } as any;
const ALICE = recId("Alice");
const COACH = recId("Coach");
const M1 = recId("M1");

/** What set_availability answers for one match (shape and size as on preview: 262 bytes). */
const OUTCOME = {
  updated: 1,
  results: [{ matchId: M1, exceptionId: "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a6b" }],
  before: [{ matchId: M1, exceptionId: "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a6b", status: "Maybe" }],
  seasons: ["2026-2027"],
};

let pg: FakePostgrest;

beforeEach(() => {
  invalidateAll();
  pg = fakePostgrest({
    tables: {
      api_players: [{ id: ALICE, email: "alice@hkfc.com", email_lower: "alice@hkfc.com", active: true, photo_file_id: null }],
    },
    rpc: {
      set_availability: () => OUTCOME,
      set_availability_for_date: () => ({ ...OUTCOME, updated: 2, results: [...OUTCOME.results, { matchId: recId("M2"), exceptionId: null }] }),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * One request after sign-in, which hands the request the cache versions
 * (auth_context): versioned reads need no read of their own.
 */
const SIGNED_IN_VERSIONS = parseCacheVersions({});
async function counted<T>(fn: () => Promise<T>): Promise<{ out: T; stats: RequestStats }> {
  const stats = newRequestStats();
  const out = await runWithRequestContext({ stats, versions: SIGNED_IN_VERSIONS }, fn);
  return { out, stats };
}
/** The player lookup an earlier request on this isolate left cached under the same versions. */
const warmPlayerLookup = () => counted(() => getPlayerByEmail(ENV, "alice@hkfc.com"));

describe("an availability tap on the wire", () => {
  it("is one call of under 2 KB after sign-in", async () => {
    await warmPlayerLookup();
    const before = pg.calls.length;
    const { out, stats } = await counted(() =>
      setMyAvailability(ENV, { email: "alice@hkfc.com", matchId: M1, status: "Unavailable", notes: "Work" }),
    );
    expect(out).toEqual({ success: true, exceptionId: OUTCOME.results[0].exceptionId });
    expect(stats.dbCalls).toBe(1);
    expect(stats.dbBytes).toBeLessThan(2048);
    expect(pg.calls.slice(before).map((c) => c.table)).toEqual(["rpc/set_availability"]);
    expect(pg.rpcCalls("set_availability")).toEqual([
      { p_player: ALICE, p_matches: [M1], p_status: "Unavailable", p_notes: "Work", p_updated_by: ALICE },
    ]);
  });

  it("is two calls when the player lookup is cold, and never reads the season's answers", async () => {
    const { stats } = await counted(() => setMyAvailability(ENV, { email: "alice@hkfc.com", matchId: M1, status: "Available" }));
    expect(stats.dbCalls).toBe(2);
    expect(stats.dbBytes).toBeLessThan(2048);
    expect(pg.calls.map((c) => c.table)).toEqual(["api_players", "rpc/set_availability"]);
  });

  it("a coach's answer for a player is one call, with the coach as Updated By", async () => {
    const { stats } = await counted(() =>
      setPlayerAvailability(ENV, { coachPersonId: COACH, playerId: ALICE, matchId: M1, status: "Maybe" }),
    );
    expect(stats.dbCalls).toBe(1);
    expect(pg.rpcCalls("set_availability")[0]).toMatchObject({ p_player: ALICE, p_updated_by: COACH });
  });

  it("a whole day is one call after sign-in", async () => {
    await warmPlayerLookup();
    const before = pg.calls.length;
    const { out, stats } = await counted(() =>
      setMyAvailabilityForDate(ENV, { email: "alice@hkfc.com", date: "2026-10-10", status: "Unavailable", notes: "Away" }),
    );
    expect(out.updated).toBe(2);
    expect(stats.dbCalls).toBe(1);
    expect(pg.calls.slice(before).map((c) => c.table)).toEqual(["rpc/set_availability_for_date"]);
    expect(pg.rpcCalls("set_availability_for_date")[0]).toEqual({ p_player: ALICE, p_date: "2026-10-10", p_status: "Unavailable", p_notes: "Away" });
  });
});

describe("set_availability's not-found errors", () => {
  const fail = (message: string) => () =>
    new Response(JSON.stringify({ code: "P0002", message, details: null, hint: null }), { status: 404 });

  it("an inactive player is a 404 in plain words", async () => {
    pg = fakePostgrest({ tables: {}, rpc: { set_availability: fail("Player not found or inactive") } });
    await expect(
      setPlayerAvailability(ENV, { coachPersonId: COACH, playerId: ALICE, matchId: M1, status: "Maybe" }),
    ).rejects.toMatchObject({ status: 404, message: "Player not found or inactive" });
  });

  it("an unknown match is a 404 in plain words", async () => {
    pg = fakePostgrest({ tables: {}, rpc: { set_availability: fail(`No match ${M1}`) } });
    await expect(
      setPlayerAvailability(ENV, { coachPersonId: COACH, playerId: ALICE, matchId: M1, status: "Maybe" }),
    ).rejects.toMatchObject({ status: 404, message: "Match not found" });
  });
});
