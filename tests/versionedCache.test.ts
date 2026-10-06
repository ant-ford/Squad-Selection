import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getVersioned, invalidateAll, requestVersions } from "../worker/src/cache";
import { db } from "../worker/src/data/supabase";
import { newRequestStats, runWithRequestContext, noteRequestVersions, type RequestStats } from "../worker/src/requestContext";
import { parseCacheVersions } from "../worker/src/cacheVersions";
import type { Env } from "../worker/src/env";
import { fakePostgrest, SUPABASE_TEST_ENV, type FakePostgrest } from "./helpers/postgrest";

/**
 * Values built from club data are kept under the cache versions of the
 * tables they were read from (cache.ts getVersioned): exact in every
 * isolate, with nothing to invalidate.
 */
const env = { ...SUPABASE_TEST_ENV } as unknown as Env;

let versions: Record<string, number>;
let pg: FakePostgrest;
beforeEach(() => {
  invalidateAll();
  versions = { matches: 1, match_selections: 1, people: 1 };
  pg = fakePostgrest({
    tables: { notes: [] },
    rpc: { read_cache_versions: () => ({ ...versions }) },
  });
});
afterEach(() => vi.unstubAllGlobals());

/** One request, as index.ts runs it; returns what `fn` returned and the request's counters. */
async function request<T>(fn: () => Promise<T>): Promise<{ value: T; stats: RequestStats }> {
  const stats = newRequestStats();
  const value = await runWithRequestContext({ stats }, fn);
  return { value, stats };
}

describe("versioned cache keys", () => {
  it("reuses a value while its tables' versions stand, and rebuilds when one moves", async () => {
    let builds = 0;
    const read = () => getVersioned(env, "scheduled", ["matches", "match_selections"], async () => ++builds);

    expect((await request(read)).value).toBe(1);
    expect((await request(read)).value).toBe(1);
    // A write to a table it doesn't read: still the same value.
    versions.people = 2;
    expect((await request(read)).value).toBe(1);
    // hkha-sync records a result: the next request, in any isolate, rebuilds.
    versions.matches = 2;
    expect((await request(read)).value).toBe(2);
    expect(builds).toBe(2);
  });

  it("drops the superseded version instead of keeping both", async () => {
    let builds = 0;
    const read = () => getVersioned(env, "scheduled", ["matches"], async () => ++builds);
    await request(read);
    versions.matches = 2;
    await request(read);
    // Back to the old versions (a request that read them before the bump): rebuilt, not served the dropped copy.
    versions.matches = 1;
    expect((await request(read)).value).toBe(3);
  });

  it("reads the versions once per request without sign-in, and not at all with it", async () => {
    const { stats } = await request(async () => {
      await getVersioned(env, "a", ["matches"], async () => 1);
      await getVersioned(env, "b", ["people"], async () => 2);
      await getVersioned(env, "c", ["matches"], async () => 3);
    });
    expect(pg.rpcCalls("read_cache_versions")).toHaveLength(1);
    expect(stats.dbCalls).toBe(1);

    // Signed in: auth_context brought them.
    const signedIn = await request(async () => {
      noteRequestVersions(parseCacheVersions({ ...versions }));
      await getVersioned(env, "d", ["matches"], async () => 4);
    });
    expect(signedIn.stats.dbCalls).toBe(0);
    expect(pg.rpcCalls("read_cache_versions")).toHaveLength(1);
  });

  it("re-reads the versions after the request writes, so it sees its own write", async () => {
    let builds = 0;
    await request(async () => {
      await getVersioned(env, "squad", ["match_selections"], async () => ++builds);
      await db(env).insert("notes", [{ id: "n1" }]);
      versions.match_selections = 2; // the write's trigger moved it
      expect(await getVersioned(env, "squad", ["match_selections"], async () => ++builds)).toBe(2);
    });
    expect(pg.rpcCalls("read_cache_versions")).toHaveLength(2);
  });

  it("caches under the plain key for 30 s when there are no versions (outside a request, or the read failed)", async () => {
    let builds = 0;
    const read = () => getVersioned(env, "plain", ["matches"], async () => ++builds);
    expect(await read()).toBe(1);
    expect(await read()).toBe(1);
    expect(await requestVersions(env)).toBeNull();

    vi.spyOn(console, "error").mockImplementation(() => {});
    pg = fakePostgrest({ rpc: { read_cache_versions: () => new Response("{}", { status: 500 }) } });
    invalidateAll();
    expect((await request(read)).value).toBe(2);
    expect((await request(read)).value).toBe(2);
  });
});
