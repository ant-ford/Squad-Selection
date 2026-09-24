import type { CacheKv } from "./env";
import { recordCacheHit, recordCacheMiss, recordKvHit } from "./requestContext";

/**
 * How long a raw Airtable table read may be reused once a webhook announces
 * Airtable-side edits (see airtableWebhook.ts). Before the webhook, a short
 * TTL was the only way an edit made in Airtable itself - a result entered,
 * a player moved between teams - reached the app, and every expiry meant a
 * full re-read of the table. With the webhook doing that job the TTL is a
 * safety net, not the mechanism.
 */
export const WEBHOOK_BACKED_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * TTL for a raw table read: `shortTtlMs` until a webhook is configured,
 * hours afterwards. Writes the Worker makes itself invalidate explicitly
 * either way, so this only governs edits made directly in Airtable.
 *
 * Requires BOTH settings, exactly as webhookConfigured() does, and the two
 * MUST agree. Keying this on the secret alone meant a half-finished set-up
 * - secret stored, id still commented out in wrangler.toml, which is
 * precisely how the first attempt went - stretched every cache to six
 * hours while the notification route stayed 404. Nothing would then have
 * told the Worker the base had changed, so a result entered in Airtable
 * could have taken six hours to reach the app: strictly worse than having
 * no webhook at all. Every partial state must fall back to short TTLs.
 *
 * Duplicated rather than imported because airtableWebhook.ts imports this
 * module; a cycle between them is not worth one predicate.
 */
export function rawReadTtl(
  env: { AIRTABLE_WEBHOOK_ID?: string; AIRTABLE_WEBHOOK_SECRET?: string },
  shortTtlMs: number,
): number {
  const configured = Boolean(env.AIRTABLE_WEBHOOK_ID && env.AIRTABLE_WEBHOOK_SECRET);
  return configured ? Math.max(shortTtlMs, WEBHOOK_BACKED_TTL_MS) : shortTtlMs;
}

// In-memory cache for Cloudflare Worker isolate.
// Data persists within a single isolate's lifetime and is refreshed after TTL.
// Multiple concurrent requests in the same isolate share the cache.

type CacheEntry<T> = {
  data: T;
  expiresAt: number;
};

const store = new Map<string, CacheEntry<any>>();

// In-flight de-dup: concurrent cold misses for the same key share one
// fetcher() call instead of each rebuilding the value independently. `token`
// identifies which in-flight fetch is authoritative for the key, so a fetch
// that invalidateCache() has already superseded knows not to commit a stale
// result after the fresher fetch has already written its own.
type PendingEntry<T> = { promise: Promise<T>; token: object };
const pending = new Map<string, PendingEntry<any>>();

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function getCached<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<{ data: T; fromCache: boolean }> {
  const now = Date.now();
  const existing = store.get(key);

  if (existing && existing.expiresAt > now) {
    recordCacheHit();
    return { data: existing.data as T, fromCache: true };
  }

  const inFlight = pending.get(key);
  if (inFlight) {
    recordCacheHit();
    const data = (await inFlight.promise) as T;
    return { data, fromCache: true };
  }

  recordCacheMiss();
  const token = {};
  const fetchPromise: Promise<T> = (async () => {
    try {
      const data = await fetcher();
      if (pending.get(key)?.token === token) {
        store.set(key, { data, expiresAt: Date.now() + ttlMs });
      }
      return data;
    } finally {
      if (pending.get(key)?.token === token) {
        pending.delete(key);
      }
    }
  })();
  pending.set(key, { promise: fetchPromise, token });

  const data = await fetchPromise;
  return { data, fromCache: false };
}

export function invalidateCache(key: string) {
  store.delete(key);
  pending.delete(key);
}

/** Remove related cached entries when one change affects multiple endpoints. */
export function invalidateCachePrefix(prefix: string) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
  for (const key of pending.keys()) {
    if (key.startsWith(prefix)) pending.delete(key);
  }
}

export function invalidateAll() {
  store.clear();
  pending.clear();
  generations.clear();
}

// ── Shared cache (KV) ───────────────────────────────────────────────────
//
// The map above lives and dies with one isolate. Cloudflare retires idle
// isolates within seconds and spreads requests across many, so on a club's
// sparse traffic most requests met an empty cache and rebuilt everything
// from Airtable - which is why a page could take ten seconds or more, and
// why the TTLs above were largely theoretical.
//
// KV holds the RAW table reads: plain arrays of records, which survive a
// JSON round trip unchanged. Derived structures stay in the map above,
// because JSON.stringify turns a Map or a Set into {} without complaining -
// season-index alone carries six of them, and a silent {} there would
// quietly break eligibility, suspensions and selections.
//
// The map stays in front of KV: a repeat read inside one isolate should not
// pay KV's latency either.

/** Below this, KV rejects the write - and nothing this cache shares is shorter. */
const KV_MIN_TTL_SECONDS = 60;

/**
 * How long an isolate may reuse its own copy of a shared entry before
 * asking KV again. Invalidation reaches KV and the isolate that did the
 * invalidating; every OTHER isolate only notices when its copy expires, so
 * this - not the KV TTL - bounds how long a stale copy can survive
 * elsewhere. A KV read a minute per key is cheap; ten minutes of a squad
 * another coach has already changed is not.
 */
const SHARED_LOCAL_TTL_MS = 60 * 1000;

/**
 * The prefixes whose KV entries are cleared together, by invalidateShared.
 *
 * Clearing one used to mean a KV list() of every key under it, then a delete
 * per key - and that ran on every availability answer and every Airtable
 * webhook ping. On the free plan an account gets 1,000 list operations a
 * day, shared by every Worker in it, and the club used them up (2026-09-23),
 * after which the cache quietly stopped working and every request went to
 * Airtable.
 *
 * Instead each prefix has a GENERATION, stored under `cache-gen:<prefix>`,
 * and entries under the prefix are stored in KV with the generation in
 * their key (`exceptions:2026-2027@<gen>`). Clearing the prefix writes a
 * new generation: one put, no list, no deletes. Entries of the old
 * generation are never read again and expire on the TTL they were written
 * with.
 *
 * Only these prefixes can be cleared (invalidateShared's parameter type
 * says so), and only keys under them pay for the generation lookup.
 */
export const SHARED_PREFIXES = [
  "player-by-email:",
  "all-matches:",
  "played-matches:",
  "match-cards:",
  "exceptions:",
] as const;
export type SharedPrefix = (typeof SHARED_PREFIXES)[number];

const GENERATION_KEY_PREFIX = "cache-gen:";

/**
 * This isolate's copy of each prefix's generation, reused for the same
 * minute as a shared entry. Another isolate's clear therefore reaches this
 * one within SHARED_LOCAL_TTL_MS - the same bound the old list-and-delete
 * had, since KV itself may serve a read up to a minute old at the edge. The
 * isolate that clears a prefix sees the new generation at once.
 */
const generations = new Map<SharedPrefix, { value: string; expiresAt: number }>();

function sharedPrefixOf(key: string): SharedPrefix | undefined {
  return SHARED_PREFIXES.find((prefix) => key.startsWith(prefix));
}

/**
 * The prefix's current generation, or null when it cannot be read. A key
 * under a prefix is never read from or written to KV without one: guessing
 * a generation could serve an entry an invalidation had already retired.
 */
async function generationOf(kv: CacheKv, prefix: SharedPrefix): Promise<string | null> {
  const now = Date.now();
  const local = generations.get(prefix);
  if (local && local.expiresAt > now) return local.value;
  try {
    const stored = await kv.get(GENERATION_KEY_PREFIX + prefix, { type: "json" });
    // Never cleared yet: generation 0.
    const value = typeof stored === "string" && stored ? stored : "0";
    generations.set(prefix, { value, expiresAt: now + SHARED_LOCAL_TTL_MS });
    return value;
  } catch (err) {
    console.error("KV generation read failed:", prefix, err);
    return null;
  }
}

/** The KV key for a shared entry, or null to skip KV for this read. */
async function kvKeyFor(kv: CacheKv, key: string): Promise<string | null> {
  const prefix = sharedPrefixOf(key);
  if (!prefix) return key;
  const generation = await generationOf(kv, prefix);
  return generation === null ? null : `${key}@${generation}`;
}

/** Unique enough: one isolate never clears the same prefix twice in a millisecond and hits the same random suffix. */
function newGeneration(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function getShared<T>(
  env: { CACHE?: CacheKv },
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<T> {
  const kv = env.CACHE;
  if (!kv) return (await getCached(key, fetcher, ttlMs)).data;

  // Wrapped in getCached so the in-isolate hit and the in-flight de-dup both
  // still apply; only a miss reaches KV, and only a KV miss reaches Airtable.
  const { data } = await getCached<T>(key, async () => {
    const kvKey = await kvKeyFor(kv, key);
    if (kvKey === null) return fetcher();

    try {
      const cached = (await kv.get(kvKey, { type: "json" })) as T | null;
      if (cached !== null && cached !== undefined) {
        recordKvHit();
        return cached;
      }
    } catch (err) {
      console.error("KV cache read failed:", kvKey, err);
    }

    const fresh = await fetcher();
    try {
      await kv.put(kvKey, JSON.stringify(fresh), {
        expirationTtl: Math.max(KV_MIN_TTL_SECONDS, Math.round(ttlMs / 1000)),
      });
    } catch (err) {
      // A cache that cannot be written is still a working request.
      console.error("KV cache write failed:", kvKey, err);
    }
    return fresh;
  }, Math.min(ttlMs, SHARED_LOCAL_TTL_MS));
  return data;
}

/**
 * Drop shared entries after a write, in KV as well as in this isolate.
 *
 * The named keys are deleted before this returns: the caller has just
 * changed the data they describe, and the next read must not be served the
 * copy it replaced. KV is eventually consistent, so this is "promptly"
 * rather than "instantly" - still far tighter than the old behaviour, where
 * another isolate kept its own copy for the full TTL and no write could
 * reach it.
 *
 * A prefix is cleared by writing it a new generation (see SHARED_PREFIXES):
 * one KV write, whatever the number of keys under it, and no list(). It is
 * awaited like the named keys, because it is now as cheap as they are.
 *
 * A named key that falls under a versioned prefix (`all-matches:2026-2027`,
 * `player-by-email:...`) is cleared the same way, by moving its prefix to a
 * new generation. Its KV entry is stored as `<key>@<generation>`, so
 * deleting the plain key removed nothing - which is how, for a few hours on
 * 2026-09-23, a squad save left other isolates serving the old selections.
 * Moving the whole prefix also clears its siblings; for these keys that is
 * at most a handful of re-reads, and it is always correct.
 */
export async function invalidateShared(
  env: { CACHE?: CacheKv },
  keys: string[],
  prefixes: SharedPrefix[] = [],
): Promise<void> {
  const plainKeys: string[] = [];
  const bump = new Set<SharedPrefix>(prefixes);
  for (const key of keys) {
    invalidateCache(key);
    const prefix = sharedPrefixOf(key);
    if (prefix) bump.add(prefix);
    else plainKeys.push(key);
  }
  for (const prefix of prefixes) invalidateCachePrefix(prefix);

  const kv = env.CACHE;
  if (!kv) return;
  try {
    await Promise.all(plainKeys.map((key) => kv.delete(key)));
  } catch (err) {
    console.error("KV cache invalidation failed:", err);
  }
  for (const prefix of bump) {
    const generation = newGeneration();
    // This isolate moves to the new generation even if the write fails: its
    // own next read must not be served what this write just replaced.
    generations.set(prefix, { value: generation, expiresAt: Date.now() + SHARED_LOCAL_TTL_MS });
    try {
      // No TTL: five small keys that must outlive every entry they govern.
      await kv.put(GENERATION_KEY_PREFIX + prefix, JSON.stringify(generation));
    } catch (err) {
      console.error("KV prefix invalidation failed:", prefix, err);
    }
  }
}
