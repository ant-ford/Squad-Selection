import type { CacheKv } from "../../worker/src/env";

/**
 * In-memory stand-in for the CACHE KV binding, recording every read, write
 * and delete so a test can say exactly what reached the shared store.
 * tests/sharedCacheMiniflare.test.ts runs the same cache code against the
 * real KV implementation; this one is for the cases that need to inspect
 * traffic rather than prove the runtime API.
 */
export interface FakeKv extends CacheKv {
  store: Map<string, { value: string; ttl?: number }>;
  reads: string[];
  writes: string[];
  deletes: string[];
}

export function fakeKv(overrides: Partial<CacheKv> = {}): FakeKv {
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
