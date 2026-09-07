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
