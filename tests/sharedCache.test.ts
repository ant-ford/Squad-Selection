import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getShared, invalidateShared, invalidateAll } from "../worker/src/cache";
import { fakeKv } from "./helpers/kv";

// The in-isolate map is what this replaces, so "a different isolate" is
// simulated by clearing it while the KV store keeps its contents.
//
// On the Supabase backend KV holds only the Stats summaries (`stats-summary:`
// keys); every other getShared read stays in the isolate. The tests of what
// survives the Airtable removal therefore use SUPABASE_ENV and a Stats key.
// The ones marked "Airtable-only" pin how raw Airtable table reads were
// shared through KV (generation keys, which keys may make the trip) and go
// with that code.

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

// Clearing a prefix used to be a KV list() plus a delete per key, on every
// availability answer and every Airtable webhook ping. The free plan allows
// 1,000 lists a day per account and the club ran out (2026-09-23).
describe("prefix clears by generation", () => {
  afterEach(() => vi.useRealTimers());

  // Airtable-only: removed with the Airtable code
  it("costs one write: no list, no deletes, however many keys are under it", async () => {
    const kv = fakeKv();
    const env = { CACHE: kv };
    for (const season of ["2024-2025", "2025-2026", "2026-2027"]) {
      await getShared(env, `exceptions:${season}`, async () => [season]);
    }
    const writesBefore = kv.writes.length;

    await invalidateShared(env, [], ["exceptions:"]);

    expect(kv.writes.slice(writesBefore)).toEqual(["cache-gen:exceptions:"]);
    expect(kv.deletes).toEqual([]);
  });

  // Airtable-only: removed with the Airtable code
  it("reads a prefix's generation at most once a minute in an isolate", async () => {
    vi.useFakeTimers();
    const kv = fakeKv();
    const env = { CACHE: kv };
    const genReads = () => kv.reads.filter((k) => k === "cache-gen:exceptions:").length;

    await getShared(env, "exceptions:2026-2027", async () => ["a"], 5_000);
    await getShared(env, "exceptions:2025-2026", async () => ["b"], 5_000);
    expect(genReads()).toBe(1);

    vi.advanceTimersByTime(61_000);
    await getShared(env, "exceptions:2026-2027", async () => ["a"], 5_000);
    expect(genReads()).toBe(2);
  });

  // Airtable-only: removed with the Airtable code
  it("reaches another isolate once its copy of the generation expires", async () => {
    vi.useFakeTimers();
    const kv = fakeKv();
    const env = { CACHE: kv };
    let value = "old";
    await getShared(env, "exceptions:2026-2027", async () => value, 5_000);

    // Isolate B has read the generation; isolate A then clears the prefix.
    // Simulated in one process: B's copy is what `generations` holds, so
    // write the new generation straight to KV as A would have.
    value = "new";
    await kv.put("cache-gen:exceptions:", JSON.stringify("gen-from-A"));

    vi.advanceTimersByTime(61_000);
    expect(await getShared(env, "exceptions:2026-2027", async () => value, 5_000)).toBe("new");
  });

  // The bug #48 shipped with: syncSquad clears `all-matches:<season>` by
  // name, but the KV entry is stored as `all-matches:<season>@<gen>`, so a
  // plain delete removed nothing and other isolates kept the old selections.
  // Airtable-only: removed with the Airtable code
  it("clears a named key under a versioned prefix, for every other isolate", async () => {
    const kv = fakeKv();
    const env = { CACHE: kv };
    let value = "before";
    await getShared(env, "all-matches:2026-2027", async () => value);
    value = "after";

    await invalidateShared(env, ["all-matches:2026-2027"]);
    newIsolate();

    expect(await getShared(env, "all-matches:2026-2027", async () => value)).toBe("after");
    expect(kv.writes).toContain("cache-gen:all-matches:");
    expect(kv.deletes).toEqual([]);
  });

  // Airtable-only: removed with the Airtable code
  it("does the same for a player-by-email lookup", async () => {
    const kv = fakeKv();
    const env = { CACHE: kv };
    let role = "player";
    await getShared(env, "player-by-email:cy@hkfc.com", async () => role);
    role = "coach";

    await invalidateShared(env, ["player-by-email:cy@hkfc.com"]);
    newIsolate();

    expect(await getShared(env, "player-by-email:cy@hkfc.com", async () => role)).toBe("coach");
  });

  // Airtable-only: removed with the Airtable code
  it("serves the clearing isolate fresh data at once", async () => {
    const kv = fakeKv();
    const env = { CACHE: kv };
    let value = "old";
    await getShared(env, "exceptions:2026-2027", async () => value);
    value = "new";

    await invalidateShared(env, [], ["exceptions:"]);

    expect(await getShared(env, "exceptions:2026-2027", async () => value)).toBe("new");
  });

  // Airtable-only: removed with the Airtable code
  it("skips KV rather than guess when the generation cannot be read", async () => {
    const kv = fakeKv();
    const realGet = kv.get.bind(kv);
    kv.get = async (key, options) => {
      if (key.startsWith("cache-gen:")) throw new Error("over quota");
      return realGet(key, options);
    };
    const env = { CACHE: kv };

    expect(await getShared(env, "exceptions:2026-2027", async () => "live")).toBe("live");
    expect(kv.writes).toEqual([]);
  });

  // Airtable-only: removed with the Airtable code
  it("leaves keys outside the prefixes without a generation lookup", async () => {
    const kv = fakeKv();
    await getShared({ CACHE: kv }, "club-reference", async () => "v");
    expect(kv.reads).toEqual(["club-reference"]);
    expect(kv.writes).toEqual(["club-reference"]);
  });
});

// The reason the split exists at all: JSON.stringify turns a Map or a Set
// into {} and says nothing. season-index carries six of them, so putting it
// in KV would quietly break eligibility, suspensions and selections. This
// pins which keys are allowed to make the trip.
describe("only raw table reads are shared", () => {
  // Airtable-only: removed with the Airtable code
  it("puts records in KV and leaves the derived indexes in the isolate", async () => {
    const { fakeAirtable } = await import("./helpers/airtable");
    const { handlePlayerCalendarFeed } = await import("../worker/src/calendar");
    const { getSeasonContext } = await import("../worker/src/seasonContext");

    const day = new Date(Date.now() + 86_400_000).toISOString().split("T")[0];
    const state = {
      People: [{
        id: "recP1",
        fields: { "Preferred Name": "Jonny", Email: "j@hkfc.com", Active: true, "Registered Team": "F", "Playing Ability": "B", "Playing Position": "Forward" },
      }],
      Teams: ["A", "B", "C", "D", "E", "F"].map((n, i) => ({ id: `recT${i}`, fields: { "Team Name": n, "Team Rank": i + 1, Active: true } })),
      Matches: [{
        id: "recM_F",
        fields: { Date: `${day}T09:00:00.000Z`, Season: "2026-2027", "Home Team": "F", "Away Team": "Opponent", "Match Status": "Scheduled", "Selected Players Home": ["recP1"] },
      }],
      "Availability Exceptions": [],
    };
    fakeAirtable(state as any);

    const kv = fakeKv();
    const env = {
      AIRTABLE_TOKEN: "***", AIRTABLE_BASE_ID: "b", CALENDAR_SECRET: "s",
      SUPABASE_URL: "https://t", SUPABASE_ANON_KEY: "***", CACHE: kv,
    } as any;

    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("s"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("player:recP1"));
    const sig = Array.from(new Uint8Array(sigBytes)).map((b) => b.toString(16).padStart(2, "0")).join("");

    const res = await handlePlayerCalendarFeed(env, "recP1", sig);
    expect(res.status).toBe(200);

    const shared = [...kv.store.keys()];
    expect(shared.length).toBeGreaterThan(0);
    for (const k of shared) {
      expect(k).toMatch(/^(club-reference|scheduled-matches|played-matches|exceptions:|all-matches:|match-cards:|availability-rules)/);
    }
    // The ones that would have been silently flattened.
    expect(shared.some((k) => k.startsWith("season-index:"))).toBe(false);
    expect(shared.some((k) => k.startsWith("session:"))).toBe(false);

    // And the derived structure still holds real Maps and Sets on a cold
    // isolate reading its raw data back out of KV.
    newIsolate();
    const ctx = await getSeasonContext(env, "2026-2027");
    expect(ctx.matchesById).toBeInstanceOf(Map);
    expect(ctx.matchesById.get("recM_F")?.homeTeam).toBe("F");
    expect(ctx.unavailablePlayerMatchKeys).toBeInstanceOf(Set);
    expect(ctx.selectionsByPlayer.get("recP1")).toBeInstanceOf(Set);
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
