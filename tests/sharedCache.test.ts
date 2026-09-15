import { describe, it, expect, beforeEach } from "vitest";
import { getShared, invalidateShared, invalidateAll } from "../worker/src/cache";
import type { CacheKv } from "../worker/src/env";

// The in-isolate map is what this replaces, so "a different isolate" is
// simulated by clearing it while the KV store keeps its contents.

interface FakeKv extends CacheKv {
  store: Map<string, { value: string; ttl?: number }>;
  reads: string[];
  writes: string[];
  deletes: string[];
}

function fakeKv(overrides: Partial<CacheKv> = {}): FakeKv {
  const store = new Map<string, { value: string; ttl?: number }>();
  const kv: FakeKv = {
    store,
    reads: [],
    writes: [],
    deletes: [],
    async get(key) {
      kv.reads.push(key);
      const hit = store.get(key);
      return hit ? JSON.parse(hit.value) : null;
    },
    async put(key, value, options) {
      kv.writes.push(key);
      store.set(key, { value, ttl: options?.expirationTtl });
    },
    async delete(key) {
      kv.deletes.push(key);
      store.delete(key);
    },
    async list({ prefix }) {
      return {
        keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
        list_complete: true as const,
      };
    },
    ...overrides,
  };
  return kv;
}

/** A new isolate: same KV, empty local map. */
function newIsolate() {
  invalidateAll();
}

beforeEach(() => invalidateAll());

describe("shared cache without a binding", () => {
  // A deploy made before the namespace exists must behave exactly as before
  // rather than failing at the first cache read.
  it("falls back to the in-isolate cache", async () => {
    let calls = 0;
    const fetcher = async () => { calls++; return ["a"]; };

    expect(await getShared({}, "k", fetcher)).toEqual(["a"]);
    expect(await getShared({}, "k", fetcher)).toEqual(["a"]);
    expect(calls).toBe(1);

    newIsolate();
    await getShared({}, "k", fetcher);
    expect(calls).toBe(2); // nothing shared it across the restart
  });
});

describe("shared cache with KV", () => {
  it("spares a second isolate the upstream read", async () => {
    const kv = fakeKv();
    let calls = 0;
    const fetcher = async () => { calls++; return [{ id: "rec1" }]; };

    await getShared({ CACHE: kv }, "scheduled-matches", fetcher);
    expect(calls).toBe(1);
    expect(kv.writes).toEqual(["scheduled-matches"]);

    newIsolate();
    const second = await getShared({ CACHE: kv }, "scheduled-matches", fetcher);

    expect(second).toEqual([{ id: "rec1" }]);
    expect(calls).toBe(1); // served from KV, not Airtable
  });

  it("answers a repeat read in one isolate without going to KV", async () => {
    const kv = fakeKv();
    const fetcher = async () => ["x"];
    await getShared({ CACHE: kv }, "k", fetcher);
    const readsAfterFirst = kv.reads.length;

    await getShared({ CACHE: kv }, "k", fetcher);
    expect(kv.reads.length).toBe(readsAfterFirst);
  });

  it("never writes a TTL below the minimum KV accepts", async () => {
    const kv = fakeKv();
    await getShared({ CACHE: kv }, "brief", async () => "v", 5 * 1000);
    expect(kv.store.get("brief")?.ttl).toBe(60);
  });

  it("shares one upstream read between concurrent callers", async () => {
    const kv = fakeKv();
    let calls = 0;
    const fetcher = async () => { calls++; return "v"; };

    await Promise.all([
      getShared({ CACHE: kv }, "k", fetcher),
      getShared({ CACHE: kv }, "k", fetcher),
      getShared({ CACHE: kv }, "k", fetcher),
    ]);
    expect(calls).toBe(1);
  });
});

describe("invalidation after a write", () => {
  it("drops the key everywhere, so another isolate cannot serve what was replaced", async () => {
    const kv = fakeKv();
    const env = { CACHE: kv };
    let value = "before";
    const fetcher = async () => value;

    await getShared(env, "scheduled-matches", fetcher);
    value = "after";

    await invalidateShared(env, ["scheduled-matches"]);
    newIsolate();

    expect(await getShared(env, "scheduled-matches", fetcher)).toBe("after");
  });

  it("clears every key under a prefix", async () => {
    const kv = fakeKv();
    const env = { CACHE: kv };
    await getShared(env, "exceptions:2026-2027", async () => ["old"]);
    await getShared(env, "exceptions:2025-2026", async () => ["old"]);
    await getShared(env, "club-reference", async () => ["kept"]);

    await invalidateShared(env, [], ["exceptions:"]);

    expect([...kv.store.keys()]).toEqual(["club-reference"]);
  });
});

// The reason the split exists at all: JSON.stringify turns a Map or a Set
// into {} and says nothing. season-index carries six of them, so putting it
// in KV would quietly break eligibility, suspensions and selections. This
// pins which keys are allowed to make the trip.
describe("only raw table reads are shared", () => {
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
    expect(await getShared({ CACHE: kv }, "k", async () => "live")).toBe("live");
  });

  it("still answers when the write throws", async () => {
    const kv = fakeKv({ put: async () => { throw new Error("over quota"); } });
    expect(await getShared({ CACHE: kv }, "k", async () => "live")).toBe("live");
  });

  it("still completes a write when invalidation throws", async () => {
    const kv = fakeKv({ delete: async () => { throw new Error("KV down"); } });
    await expect(invalidateShared({ CACHE: kv }, ["k"])).resolves.toBeUndefined();
  });
});
