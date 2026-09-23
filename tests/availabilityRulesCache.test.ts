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
// ---------------------------------------------------------------------------

import {
  createAvailabilityRule,
  deleteAvailabilityRule,
  getAllAvailabilityRules,
} from "../worker/src/availabilityRules";
import { invalidateAll } from "../worker/src/cache";
import type { CacheKv } from "../worker/src/env";
import { fakeAirtable, type FakeTables } from "./helpers/airtable";

function fakeKv(): CacheKv & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key) {
      const hit = store.get(key);
      return hit === undefined ? null : JSON.parse(hit);
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

const BASE_ENV = {
  AIRTABLE_TOKEN: "***",
  AIRTABLE_BASE_ID: "test-base",
  CALENDAR_SECRET: "***",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
};

let rules: any[];
let handle: ReturnType<typeof fakeAirtable>;

beforeEach(() => {
  invalidateAll();
  rules = [
    { id: "recR1", fields: { Player: ["recP1"], "Rule Type": "Play-ups", Availability: "Unavailable", Active: true } },
  ];
  const tables: FakeTables = {
    get "Availability Rules"() { return rules; },
  };
  handle = fakeAirtable(tables);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a failed rules read", () => {
  it("degrades to no rules for that request only, and reads again next time", async () => {
    const env = { ...BASE_ENV } as any;
    vi.spyOn(console, "error").mockImplementation(() => {});

    // First request: Airtable is failing. (A 500 rather than a 429, so the
    // client's rate-limit retries do not slow the test down; the caching
    // behaviour under test is the same for both.)
    const realFetch = handle.fetchMock.getMockImplementation()!;
    handle.fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "SERVER_ERROR" }), { status: 500 })),
    );
    expect(await getAllAvailabilityRules(env)).toEqual([]);

    // Second request: Airtable is back. The empty answer must not have been
    // kept - this is what let a preference silently stop applying.
    handle.fetchMock.mockImplementation(realFetch);
    const recovered = await getAllAvailabilityRules(env);
    expect(recovered.map((r) => r.id)).toEqual(["recR1"]);
  });
});

describe("the rules cache is shared across isolates", () => {
  it("serves another isolate from the shared store without reading Airtable again", async () => {
    const env = { ...BASE_ENV, CACHE: fakeKv() } as any;
    await getAllAvailabilityRules(env);
    const readsAfterFirst = handle.calls.filter((c) => c.url.includes("Availability%20Rules")).length;
    expect(readsAfterFirst).toBe(1);

    invalidateAll(); // a different isolate: empty local map, same KV
    const again = await getAllAvailabilityRules(env);
    expect(again.map((r) => r.id)).toEqual(["recR1"]);
    expect(handle.calls.filter((c) => c.url.includes("Availability%20Rules")).length).toBe(1);
  });

  it("a saved preference reaches every isolate, not just the one that took the write", async () => {
    const env = { ...BASE_ENV, CACHE: fakeKv() } as any;
    // Isolate A warms the shared copy.
    expect((await getAllAvailabilityRules(env)).map((r) => r.id)).toEqual(["recR1"]);

    // Isolate B saves a new rule. Airtable-side it now exists.
    invalidateAll();
    await createAvailabilityRule(env, "recP1", { ruleType: "Midweek", availability: "Unavailable" });

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
    await deleteAvailabilityRule(env, "recP1", "recR1");

    invalidateAll();
    expect(await getAllAvailabilityRules(env)).toEqual([]);
  });
});
