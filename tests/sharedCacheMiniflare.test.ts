import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Miniflare } from "miniflare";
import { getShared, invalidateShared, invalidateAll } from "../worker/src/cache";
import type { CacheKv } from "../worker/src/env";

// The other cache tests run against a fake KV I wrote, which proves the
// cache's own logic but cannot prove I understood Cloudflare's API. This one
// runs the same code against Miniflare's real KV implementation - the same
// workerd runtime a deploy uses - so a wrong call shape, a rejected option or
// a misread return value fails here rather than in production.

let mf: Miniflare;
let kv: CacheKv;

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: `export default { fetch() { return new Response("ok"); } }`,
    kvNamespaces: ["CACHE"],
  });
  kv = (await mf.getKVNamespace("CACHE")) as unknown as CacheKv;
}, 60_000);

afterAll(async () => {
  await mf?.dispose();
});

beforeEach(() => invalidateAll());

describe("shared cache against real KV", () => {
  it("round-trips a record array through KV to a second isolate", async () => {
    const env = { CACHE: kv };
    let calls = 0;
    const fetcher = async () => { calls++; return [{ id: "rec1", homeTeam: "HKFC C", score: 3 }]; };

    await getShared(env, "mf:scheduled-matches", fetcher);
    invalidateAll(); // the next isolate

    const again = await getShared(env, "mf:scheduled-matches", fetcher);
    expect(again).toEqual([{ id: "rec1", homeTeam: "HKFC C", score: 3 }]);
    expect(calls).toBe(1);
  });

  // Real KV rejects expirationTtl under 60 with an error; the floor in the
  // cache exists for exactly this, and here it is exercised for real.
  it("writes with a TTL the runtime accepts", async () => {
    const env = { CACHE: kv };
    await getShared(env, "mf:short", async () => "v", 5 * 1000);
    invalidateAll();
    expect(await kv.get("mf:short", { type: "json" })).toBe("v");
  });

  it("invalidates a key so the next isolate reads upstream again", async () => {
    const env = { CACHE: kv };
    let value = "before";
    await getShared(env, "mf:inv", async () => value);
    value = "after";

    await invalidateShared(env, ["mf:inv"]);
    invalidateAll();

    expect(await getShared(env, "mf:inv", async () => value)).toBe("after");
  });

  it("clears a prefix using the runtime's own list()", async () => {
    const env = { CACHE: kv };
    await getShared(env, "mf:exceptions:2026-2027", async () => ["a"]);
    await getShared(env, "mf:exceptions:2025-2026", async () => ["b"]);
    await getShared(env, "mf:club-reference", async () => ["kept"]);

    await invalidateShared(env, [], ["mf:exceptions:"]);

    expect(await kv.get("mf:exceptions:2026-2027", { type: "json" })).toBeNull();
    expect(await kv.get("mf:exceptions:2025-2026", { type: "json" })).toBeNull();
    expect(await kv.get("mf:club-reference", { type: "json" })).toEqual(["kept"]);
  });

  it("treats a missing key as a miss, not as a cached null", async () => {
    const env = { CACHE: kv };
    let calls = 0;
    const result = await getShared(env, "mf:never-written", async () => { calls++; return "fresh"; });
    expect(result).toBe("fresh");
    expect(calls).toBe(1);
  });
});
