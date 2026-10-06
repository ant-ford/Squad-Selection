import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getShared, invalidateShared, invalidateAll } from "../worker/src/cache";
import { newRequestStats, runWithRequestContext } from "../worker/src/requestContext";
import { fakeKv } from "./helpers/kv";

// The in-isolate map is what this replaces, so "a different isolate" is
// simulated by clearing it while the KV store keeps its contents.
//
// On the Supabase backend KV holds only the Stats summaries (`stats-summary:`
// keys); every other getShared read stays in the isolate. The tests of what
// survives the Airtable removal therefore use SUPABASE_ENV and a Stats key.

/** A new isolate: same KV, empty local map. */
function newIsolate() {
  invalidateAll();
}

const SUPABASE = "supabase";
/** A Stats summary: the one kind of entry KV keeps on Supabase. */
const STATS_KEY = "stats-summary:2025-2026";

beforeEach(() => invalidateAll());

describe("shared cache without a binding", () => {
  // A deploy made before the namespace exists must behave exactly as before
  // rather than failing at the first cache read.
  it("falls back to the in-isolate cache", async () => {
    let calls = 0;
    const fetcher = async () => { calls++; return ["a"]; };
    const env = { DATA_BACKEND: SUPABASE };

    expect(await getShared(env, STATS_KEY, fetcher)).toEqual(["a"]);
    expect(await getShared(env, STATS_KEY, fetcher)).toEqual(["a"]);
    expect(calls).toBe(1);

    newIsolate();
    await getShared(env, STATS_KEY, fetcher);
    expect(calls).toBe(2); // nothing shared it across the restart
  });
});

describe("shared cache with KV", () => {
  it("spares a second isolate the upstream read", async () => {
    const kv = fakeKv();
    const env = { CACHE: kv, DATA_BACKEND: SUPABASE };
    let calls = 0;
    const fetcher = async () => { calls++; return [{ id: "rec1" }]; };

    await getShared(env, STATS_KEY, fetcher);
    expect(calls).toBe(1);
    expect(kv.writes).toEqual([STATS_KEY]);

    newIsolate();
    const second = await getShared(env, STATS_KEY, fetcher);

    expect(second).toEqual([{ id: "rec1" }]);
    expect(calls).toBe(1); // served from KV, not rebuilt
  });

  it("answers a repeat read in one isolate without going to KV", async () => {
    const kv = fakeKv();
    const env = { CACHE: kv, DATA_BACKEND: SUPABASE };
    const fetcher = async () => ["x"];
    await getShared(env, STATS_KEY, fetcher);
    const readsAfterFirst = kv.reads.length;

    await getShared(env, STATS_KEY, fetcher);
    expect(kv.reads.length).toBe(readsAfterFirst);
  });

  it("never writes a TTL below the minimum KV accepts", async () => {
    const kv = fakeKv();
    await getShared({ CACHE: kv, DATA_BACKEND: SUPABASE }, "stats-summary:brief", async () => "v", 5 * 1000);
    expect(kv.store.get("stats-summary:brief")?.ttl).toBe(60);
  });

  it("shares one upstream read between concurrent callers", async () => {
    const kv = fakeKv();
    const env = { CACHE: kv, DATA_BACKEND: SUPABASE };
    let calls = 0;
    const fetcher = async () => { calls++; return "v"; };

    await Promise.all([
      getShared(env, STATS_KEY, fetcher),
      getShared(env, STATS_KEY, fetcher),
      getShared(env, STATS_KEY, fetcher),
    ]);
    expect(calls).toBe(1);
  });
});

// Ported from airtableAccess.test.ts ("shared cache lifetimes").
describe("shared cache lifetimes", () => {
  afterEach(() => vi.useRealTimers());

  it("caps the in-isolate copy of a shared entry at a minute whatever KV's TTL is", async () => {
    vi.useFakeTimers();
    const kv = fakeKv();
    const env = { CACHE: kv, DATA_BACKEND: SUPABASE };
    let fetches = 0;
    const fetcher = async () => { fetches++; return ["v"]; };
    const sixHours = 6 * 60 * 60 * 1000;

    await getShared(env, STATS_KEY, fetcher, sixHours);
    expect(kv.store.get(STATS_KEY)?.ttl).toBe(sixHours / 1000);
    const readsAfterFirst = kv.reads.length;

    vi.advanceTimersByTime(30_000);
    await getShared(env, STATS_KEY, fetcher, sixHours);
    expect(kv.reads.length).toBe(readsAfterFirst);

    vi.advanceTimersByTime(31_000);
    await getShared(env, STATS_KEY, fetcher, sixHours);
    expect(kv.reads.length).toBe(readsAfterFirst + 1);
    expect(fetches).toBe(1);
  });

  it("clears named keys and prefixes before returning, with nothing left for after the response", async () => {
    const kv = fakeKv();
    await kv.put(STATS_KEY, "[]");
    const pending: Promise<unknown>[] = [];

    await runWithRequestContext({ stats: newRequestStats(), waitUntil: (p) => { pending.push(p); } }, () =>
      invalidateShared({ CACHE: kv, DATA_BACKEND: SUPABASE }, [STATS_KEY], ["exceptions:"]),
    );
    expect(kv.store.has(STATS_KEY)).toBe(false);
    expect(pending.length).toBe(0);
  });
});

describe("invalidation after a write", () => {
  it("drops the key everywhere, so another isolate cannot serve what was replaced", async () => {
    const kv = fakeKv();
    const env = { CACHE: kv, DATA_BACKEND: SUPABASE };
    let value = "before";
    const fetcher = async () => value;

    await getShared(env, STATS_KEY, fetcher);
    value = "after";

    await invalidateShared(env, [STATS_KEY]);
    newIsolate();

    expect(await getShared(env, STATS_KEY, fetcher)).toBe("after");
  });

  // On Supabase these keys live in the isolate only, so "everywhere" is this
  // isolate: the clear is checked without simulating a second one, and
  // nothing reaches KV.
  it("clears every key under a prefix, and nothing outside it", async () => {
    const kv = fakeKv();
    const env = { CACHE: kv, DATA_BACKEND: SUPABASE };
    let value = "old";
    await getShared(env, "exceptions:2026-2027", async () => [value]);
    await getShared(env, "exceptions:2025-2026", async () => [value]);
    await getShared(env, "club-reference", async () => [value]);
    value = "new";

    await invalidateShared(env, [], ["exceptions:"]);

    expect(await getShared(env, "exceptions:2026-2027", async () => [value])).toEqual(["new"]);
    expect(await getShared(env, "exceptions:2025-2026", async () => [value])).toEqual(["new"]);
    expect(await getShared(env, "club-reference", async () => [value])).toEqual(["old"]);
    expect(kv.writes).toEqual([]);
  });
});

describe("when KV itself misbehaves", () => {
  // A cache is an optimisation. Losing it must not lose the request.
  it("still answers when the read throws", async () => {
    const kv = fakeKv({ get: async () => { throw new Error("KV down"); } });
    expect(await getShared({ CACHE: kv, DATA_BACKEND: SUPABASE }, STATS_KEY, async () => "live")).toBe("live");
  });

  it("still answers when the write throws", async () => {
    const kv = fakeKv({ put: async () => { throw new Error("over quota"); } });
    expect(await getShared({ CACHE: kv, DATA_BACKEND: SUPABASE }, STATS_KEY, async () => "live")).toBe("live");
  });

  it("still completes a write when invalidation throws", async () => {
    const kv = fakeKv({ delete: async () => { throw new Error("KV down"); } });
    await expect(invalidateShared({ CACHE: kv, DATA_BACKEND: SUPABASE }, [STATS_KEY])).resolves.toBeUndefined();
  });
});

describe("cache clearing on the Supabase backend", () => {
  // Only the Stats summaries are read from KV there (getShared), so clearing
  // anything else would just spend the free plan's 1,000 deletes and writes a day.
  it("touches KV only for the Stats summaries", async () => {
    const kv = fakeKv();
    const env = { CACHE: kv, DATA_BACKEND: "supabase" };
    await invalidateShared(env, ["scheduled-matches", "player-by-email:a@b.c", "stats-summary:current"], ["exceptions:"]);
    expect(kv.deletes).toEqual(["stats-summary:current"]);
    expect(kv.writes).toEqual([]);
  });

  // The read side of the same rule: any other key is held in the isolate,
  // and KV is never asked or written.
  it("keeps every other read out of KV, and still caches it in the isolate", async () => {
    const kv = fakeKv();
    const env = { CACHE: kv, DATA_BACKEND: "supabase" };
    let calls = 0;
    const fetcher = async () => { calls++; return [{ id: "rec1" }]; };

    for (const key of ["scheduled-matches:v2", "player-by-email:a@b.c", "exceptions:2026-2027", "club-reference"]) {
      await getShared(env, key, fetcher);
      await getShared(env, key, fetcher);
    }
    expect(calls).toBe(4);
    expect(kv.reads).toEqual([]);
    expect(kv.writes).toEqual([]);
  });
});
