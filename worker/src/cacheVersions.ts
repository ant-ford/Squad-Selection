/**
 * The database's cache versions (supabase/migrations/*_cache_versions.sql):
 * one counter per table the Worker caches, bumped by a statement trigger in
 * the same transaction as every real change to that table, whoever made it
 * (the Worker, hkha-sync, the Table Editor).
 *
 * A cache key that carries the versions of the tables its value was built
 * from is exact in every isolate: a write anywhere moves the version, and
 * the next request misses. Read the versions BEFORE the data cached under
 * them; data read later is at least as new.
 */
import type { Env } from "./env";
import { db } from "./data/supabase";

/** The cache_versions keys: table names (shirt_numbers counts as people). */
export const CACHE_VERSION_KEYS = [
  "matches",
  "match_cards",
  "match_selections",
  "availability_exceptions",
  "availability_rules",
  "people",
  "teams",
  "team_people",
  "offices",
  "events",
  "event_responses",
] as const;

export type CacheVersionKey = (typeof CACHE_VERSION_KEYS)[number];
export type CacheVersions = Readonly<Record<CacheVersionKey, number>>;

/**
 * The versions from read_cache_versions() / auth_context(): {key: number}.
 * A key the database does not have reads as 0, so a Worker deployed before
 * a new key's migration still builds stable keys.
 */
export function parseCacheVersions(raw: unknown): CacheVersions {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = {} as Record<CacheVersionKey, number>;
  for (const key of CACHE_VERSION_KEYS) {
    const value = Number(source[key]);
    out[key] = Number.isFinite(value) ? value : 0;
  }
  return out;
}

/** One small read: every counter (~0.3 KB). */
export async function readCacheVersions(env: Env): Promise<CacheVersions> {
  return parseCacheVersions(await db(env).rpcRead<unknown>("read_cache_versions", {}));
}
