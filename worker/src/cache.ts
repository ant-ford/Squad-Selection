import type { CacheKv } from "./env";
import { currentRequestContext, recordCacheHit, recordCacheMiss, recordKvHit } from "./requestContext";

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

/**
 * How long a request waits on a fetch another request started before giving
 * up on it and fetching for itself.
 *
 * The shared fetch belongs to the request that started it. When that
 * request's client goes away - a coach leaves the page mid-load, a timeout -
 * Cloudflare cancels the request and the database/KV calls it had in
 * flight, and the shared promise never settles. Before this, everyone
 * waiting on it waited forever: on 2026-09-24 one aborted load on the
 * preview left every later request on that isolate pending for 15+ minutes
 * while the data itself came back in 1.6 s.
 *
 * Long enough for an honest cold read (a season's tables, a 429 or two) to
 * be shared; short enough that a stranded one costs a coach seconds.
 */
const SHARED_WAIT_TIMEOUT_MS = 20 * 1000;

type Settled<T> = { settled: true; ok: true; value: T } | { settled: true; ok: false; error: unknown } | { settled: false };

function settleWithin<T>(promise: Promise<T>, ms: number): Promise<Settled<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Settled<T>>((resolve) => {
    timer = setTimeout(() => resolve({ settled: false }), ms);
  });
  const outcome = promise.then(
    (value): Settled<T> => ({ settled: true, ok: true, value }),
    (error): Settled<T> => ({ settled: true, ok: false, error }),
  );
  return Promise.race([outcome, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

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
    const shared = await settleWithin(inFlight.promise as Promise<T>, SHARED_WAIT_TIMEOUT_MS);
    if (shared.settled) {
      recordCacheHit();
      if (shared.ok) return { data: shared.value, fromCache: true };
      throw shared.error;
    }
    // Stranded (see SHARED_WAIT_TIMEOUT_MS). Take the key over, so later
    // callers wait on this fetch instead of the dead one; if the old one
    // does finish, its token no longer matches and it commits nothing.
    console.warn(`Shared fetch for ${key} still pending after ${SHARED_WAIT_TIMEOUT_MS}ms; fetching independently`);
    if (pending.get(key) === inFlight) pending.delete(key);
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
  // Other requests may be waiting on this fetch, so it must not die with
  // this request: waitUntil lets it finish if this client goes away first.
  currentRequestContext()?.waitUntil?.(fetchPromise.catch(() => undefined));

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
// A database read is a few tens of milliseconds, so shared copies of data
// are not worth their staleness (hkha-sync and other writers do not announce
// their changes) or the free plan's 1,000 KV writes a day: reads are held
// briefly in the isolate only.
//
// The Stats summaries are the exception. They are expensive to build and
// must never be rebuilt on the request path, so they live in KV, where every
// isolate shares one copy. The map above stays in front of KV: a repeat read
// inside one isolate should not pay KV's latency either.

/** Below this, KV rejects the write - and nothing this cache shares is shorter. */
const KV_MIN_TTL_SECONDS = 60;

/**
 * How long an isolate may reuse its own copy of a KV entry before asking KV
 * again. Invalidation reaches KV and the isolate that did the invalidating;
 * every OTHER isolate only notices when its copy expires, so this - not the
 * KV TTL - bounds how long a stale copy can survive elsewhere.
 */
const SHARED_LOCAL_TTL_MS = 60 * 1000;

/** How long an isolate holds any other getShared read. */
const LOCAL_TTL_MS = 30 * 1000;

/** The keys kept in KV: the Stats summaries (clubStats.ts). */
const KV_PREFIXES = ["stats-summary:"];
const inKv = (key: string) => KV_PREFIXES.some((p) => key.startsWith(p));

export async function getShared<T>(
  env: { CACHE?: CacheKv },
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<T> {
  if (!inKv(key)) return (await getCached(key, fetcher, Math.min(ttlMs, LOCAL_TTL_MS))).data;
  const kv = env.CACHE;
  if (!kv) return (await getCached(key, fetcher, ttlMs)).data;

  // Wrapped in getCached so the in-isolate hit and the in-flight de-dup both
  // still apply; only a miss reaches KV, and only a KV miss is rebuilt.
  const { data } = await getCached<T>(key, async () => {
    try {
      const cached = (await kv.get(key, { type: "json" })) as T | null;
      if (cached !== null && cached !== undefined) {
        recordKvHit();
        return cached;
      }
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
  }, Math.min(ttlMs, SHARED_LOCAL_TTL_MS));
  return data;
}

/**
 * Drop entries after a write: the named keys and every key under the given
 * prefixes in this isolate, and the named Stats summaries in KV too.
 *
 * The KV deletes finish before this returns: the caller has just changed the
 * data they describe, and the next read must not be served the copy it
 * replaced. KV is eventually consistent, so this is "promptly" rather than
 * "instantly".
 */
export async function invalidateShared(env: { CACHE?: CacheKv }, keys: string[], prefixes: string[] = []): Promise<void> {
  for (const key of keys) invalidateCache(key);
  for (const prefix of prefixes) invalidateCachePrefix(prefix);

  const kv = env.CACHE;
  if (!kv) return;
  try {
    await Promise.all(keys.filter(inKv).map((key) => kv.delete(key)));
  } catch (err) {
    console.error("KV cache invalidation failed:", err);
  }
}
