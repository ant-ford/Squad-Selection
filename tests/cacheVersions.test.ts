import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakePostgrest, SUPABASE_TEST_ENV } from "./helpers/postgrest";
import type { Env } from "../worker/src/env";
import { CACHE_VERSION_KEYS, parseCacheVersions, readCacheVersions } from "../worker/src/cacheVersions";
import { newRequestStats, runWithRequestContext } from "../worker/src/requestContext";

const env = { ...SUPABASE_TEST_ENV } as Env;
afterEach(() => vi.unstubAllGlobals());

/** Every migration that adds cache versions (the table's own, and later keys), joined. */
function migration(): string {
  const dir = "supabase/migrations";
  const files = readdirSync(dir).filter((f) => /_cache_versions(_[a-z_]+)?\.sql$/.test(f)).sort();
  if (files.length === 0) throw new Error("no cache_versions migration");
  return files.map((f) => readFileSync(`${dir}/${f}`, "utf8")).join("\n");
}

describe("cache versions", () => {
  it("the Worker's keys are exactly the rows the migrations seed", () => {
    const keys = [...migration().matchAll(/insert into public\.cache_versions \(key\) values([\s\S]*?);/g)]
      .flatMap((m) => [...m[1].matchAll(/\('([a-z_]+)'\)/g)].map((k) => k[1]));
    expect([...keys].sort()).toEqual([...CACHE_VERSION_KEYS].sort());
  });

  it("every key has a table whose triggers bump it, and shirt numbers bump people", () => {
    const rows = [...migration().matchAll(/\('([a-z_]+)',\s*'([a-z_]+)',\s*array\[/g)].map((m) => [m[1], m[2]]);
    const bumped = new Set(rows.map(([, key]) => key));
    for (const key of CACHE_VERSION_KEYS) expect(bumped.has(key), key).toBe(true);
    expect(rows).toContainEqual(["shirt_numbers", "people"]);
    // Bookkeeping columns that change without anything a reader sees.
    expect(migration()).toMatch(/\('matches',\s*'matches',\s*array\['last_hkha_sync'\]\)/);
    expect(migration()).toMatch(/\('people',\s*'people',\s*array\['last_seen_at'\]\)/);
  });

  it("reads every counter in one call, a missing key as 0", async () => {
    const pg = fakePostgrest({ rpc: { read_cache_versions: () => ({ matches: 12, people: "40", stray: 3 }) } });
    const stats = newRequestStats();
    const versions = await runWithRequestContext({ stats }, () => readCacheVersions(env));
    expect(versions.matches).toBe(12);
    expect(versions.people).toBe(40);
    expect(versions.teams).toBe(0);
    expect(Object.keys(versions).sort()).toEqual([...CACHE_VERSION_KEYS].sort());
    expect(pg.rpcCalls("read_cache_versions")).toHaveLength(1);
    expect(stats.dbCalls).toBe(1);
  });

  it("anything that is not an object reads as all zeros", () => {
    expect(parseCacheVersions(null).matches).toBe(0);
    expect(parseCacheVersions("x").events).toBe(0);
    expect(parseCacheVersions({ matches: "nope" }).matches).toBe(0);
  });
});
