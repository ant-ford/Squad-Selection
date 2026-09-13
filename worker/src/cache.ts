import type { CacheKv } from "./env";

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
    return { data: existing.data as T, fromCache: true };
  }

  const inFlight = pending.get(key);
  if (inFlight) {
    const data = (await inFlight.promise) as T;
    return { data, fromCache: true };
  }

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
    try {
      const cached = (await kv.get(key, { type: "json" })) as T | null;
      if (cached !== null && cached !== undefined) return cached;
    } catch (err) {
      console.error("KV cache read failed:", key, err);
    }

    const fresh = await fetcher();
    try {
      await kv.put(key, JSON.stringify(fresh), {
        expirationTtl: Math.max(KV_MIN_TTL_SECONDS, Math.round(ttlMs / 1000)),
      });
    } catch (err) {
      // A cache that cannot be written is still a working request.
      console.error("KV cache write failed:", key, err);
    }
    return fresh;
  }, ttlMs);
  return data;
}

/**
 * Drop shared entries after a write, in KV as well as in this isolate.
 *
 * Awaited rather than fired and forgotten: the caller has just changed the
 * data these keys describe, and the next read must not be served the copy it
 * replaced. KV is eventually consistent, so this is "promptly" rather than
 * "instantly" - still far tighter than the old behaviour, where another
 * isolate kept its own copy for the full TTL and no write could reach it.
 */
export async function invalidateShared(
  env: { CACHE?: CacheKv },
  keys: string[],
  prefixes: string[] = [],
): Promise<void> {
  for (const key of keys) invalidateCache(key);
  for (const prefix of prefixes) invalidateCachePrefix(prefix);

  const kv = env.CACHE;
  if (!kv) return;
  try {
    await Promise.all(keys.map((key) => kv.delete(key)));
    for (const prefix of prefixes) {
      // list() pages; a prefix with more keys than one page returns would
      // otherwise leave the tail in place.
      let cursor: string | undefined;
      do {
        const page = await kv.list({ prefix, cursor });
        await Promise.all(page.keys.map((k) => kv.delete(k.name)));
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
    }
  } catch (err) {
    console.error("KV cache invalidation failed:", err);
  }
}
