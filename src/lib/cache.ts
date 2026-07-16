// In-memory cache for Cloudflare Worker isolate.
// Data persists within a single isolate's lifetime and is refreshed after TTL.
// Multiple concurrent requests in the same isolate share the cache.

type CacheEntry<T> = {
  data: T;
  expiresAt: number;
};

const store = new Map<string, CacheEntry<any>>();

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

  const data = await fetcher();
  store.set(key, { data, expiresAt: now + ttlMs });
  return { data, fromCache: false };
}

export function invalidateCache(key: string) {
  store.delete(key);
}

/** Remove related cached entries when one change affects multiple endpoints. */
export function invalidateCachePrefix(prefix: string) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export function invalidateAll() {
  store.clear();
}
