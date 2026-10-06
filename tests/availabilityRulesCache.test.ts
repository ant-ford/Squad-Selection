import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// The standing-rules read (worker/src/availabilityRules.ts ::
// getAllAvailabilityRules) and what it caches.
//
// A player's "no to play-ups" stopped applying to fixtures added later, and
// came back when they saved the preference again. Two things about the old
// read could do that: a failed read was cached as "no rules" for five
// minutes, and the cache was per isolate, so saving a rule cleared only the
// isolate that took the write. These pin the replacements.
//
// On Supabase (cache.ts getShared) the rules are not put in the shared KV
// store at all: a read costs tens of milliseconds, so each isolate holds its
// own copy for 30 seconds at most and a new isolate reads fresh. That is how
// a saved or deleted preference reaches every isolate now.
// ---------------------------------------------------------------------------

import {
  createAvailabilityRule,
  deleteAvailabilityRule,
  getAllAvailabilityRules,
} from "../worker/src/availabilityRules";
import { invalidateAll } from "../worker/src/cache";
import { SupabaseError } from "../worker/src/data/supabase";
import { useFakeRepos } from "./helpers/fakeRepos";
import { fakePostgrest, SUPABASE_TEST_ENV } from "./helpers/postgrest";
import { fakeKv } from "./helpers/kv";
import { recId, rule } from "./helpers/factories";

const BASE_ENV = {
  ...SUPABASE_TEST_ENV,
  CALENDAR_SECRET: "***",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
};

const P1 = recId("P1");
const R1 = recId("R1");

const db = useFakeRepos(() => ({
  availabilityRules: [rule({ id: R1, player: [P1], ruleType: "Play-ups", availability: "Unavailable", active: true })],
}));

const listReads = () => db.callsTo("availabilityRules", "listAll").length;

beforeEach(() => {
  invalidateAll();
  // Nothing here should reach Supabase directly; any request fails the test.
  fakePostgrest({ tables: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a failed rules read", () => {
  it("degrades to no rules for that request only, and reads again next time", async () => {
    const env = { ...BASE_ENV } as any;
    vi.spyOn(console, "error").mockImplementation(() => {});

    // First request: Supabase is failing.
    vi.spyOn(db.repos.availabilityRules, "listAll").mockRejectedValueOnce(new SupabaseError("Supabase 500", 500));
    expect(await getAllAvailabilityRules(env)).toEqual([]);

    // Second request: Supabase is back. The empty answer must not have been
    // kept - this is what let a preference silently stop applying.
    const recovered = await getAllAvailabilityRules(env);
    expect(recovered.map((r) => r.id)).toEqual([R1]);
  });
});

describe("the rules cache across isolates", () => {
  // Supabase path: a new isolate reads the rules again instead of being
  // served from the shared KV copy (see the header). The Airtable version
  // expected 1 read in total; on Supabase it is 2, and KV is never written.
  it("does not keep the rules in the shared store: another isolate reads them fresh", async () => {
    const kv = fakeKv();
    const env = { ...BASE_ENV, CACHE: kv } as any;
    await getAllAvailabilityRules(env);
    const readsAfterFirst = listReads();
    expect(readsAfterFirst).toBe(1);

    invalidateAll(); // a different isolate: empty local map, same KV
    const again = await getAllAvailabilityRules(env);
    expect(again.map((r) => r.id)).toEqual([R1]);
    expect(listReads()).toBe(2);
    expect(kv.writes).toEqual([]);
  });

  it("a saved preference reaches every isolate, not just the one that took the write", async () => {
    const env = { ...BASE_ENV, CACHE: fakeKv() } as any;
    // Isolate A warms its copy.
    expect((await getAllAvailabilityRules(env)).map((r) => r.id)).toEqual([R1]);

    // Isolate B saves a new rule. It now exists in the database.
    invalidateAll();
    await createAvailabilityRule(env, P1, { ruleType: "Midweek", availability: "Unavailable" });

    // Isolate C, which has never read anything, must see both.
    invalidateAll();
    const seen = await getAllAvailabilityRules(env);
    expect(seen).toHaveLength(2);
    expect(seen.map((r) => r.ruleType).sort()).toEqual(["Midweek", "Play-ups"]);
  });

  it("a deleted preference is gone everywhere too", async () => {
    const env = { ...BASE_ENV, CACHE: fakeKv() } as any;
    await getAllAvailabilityRules(env);

    invalidateAll();
    await deleteAvailabilityRule(env, P1, R1);

    invalidateAll();
    expect(await getAllAvailabilityRules(env)).toEqual([]);
  });
});
