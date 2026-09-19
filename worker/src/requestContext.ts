/**
 * Per-request context: instrumentation counters and a hook for background
 * work, reachable from anywhere on the request's call path without threading
 * an extra argument through every function.
 *
 * Backed by AsyncLocalStorage, which Cloudflare provides under the
 * `nodejs_als` compatibility flag. Outside a request (tests that call a
 * module directly, the scheduled handler) there is simply no store, and
 * every helper here is a no-op - the counters are diagnostics, never
 * behaviour.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestStats {
  /** Airtable REST calls made for this request. */
  airtableCalls: number;
  /** Wall time spent waiting on Airtable, in ms (summed across calls). */
  airtableMs: number;
  /** Airtable response bytes received (JSON text length). */
  airtableBytes: number;
  /** 429 responses Airtable sent this request (each cost a sleep + retry). */
  airtableRateLimited: number;
  /** In-isolate cache hits. */
  cacheHits: number;
  /** Cache misses that had to run their fetcher. */
  cacheMisses: number;
  /** Misses answered by KV rather than upstream. */
  kvHits: number;
}

export interface RequestContext {
  stats: RequestStats;
  /**
   * Cloudflare's ctx.waitUntil, when the request has one. Lets a cache
   * invalidation finish after the response has gone out instead of holding
   * it up.
   */
  waitUntil?: (promise: Promise<unknown>) => void;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function newRequestStats(): RequestStats {
  return {
    airtableCalls: 0,
    airtableMs: 0,
    airtableBytes: 0,
    airtableRateLimited: 0,
    cacheHits: 0,
    cacheMisses: 0,
    kvHits: 0,
  };
}

/** Run `fn` with `context` as the current request context. */
export function runWithRequestContext<R>(context: RequestContext, fn: () => R): R {
  return storage.run(context, fn);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function recordAirtableCall(ms: number, bytes: number, rateLimitedAttempts = 0): void {
  const stats = storage.getStore()?.stats;
  if (!stats) return;
  stats.airtableCalls += 1;
  stats.airtableMs += ms;
  stats.airtableBytes += bytes;
  stats.airtableRateLimited += rateLimitedAttempts;
}

export function recordCacheHit(): void {
  const stats = storage.getStore()?.stats;
  if (stats) stats.cacheHits += 1;
}

export function recordCacheMiss(): void {
  const stats = storage.getStore()?.stats;
  if (stats) stats.cacheMisses += 1;
}

export function recordKvHit(): void {
  const stats = storage.getStore()?.stats;
  if (stats) stats.kvHits += 1;
}

/**
 * Run work after the response is sent when the platform allows it; await it
 * inline otherwise (tests, and any caller outside a request). Errors are
 * logged, never thrown: the work is housekeeping and the response it would
 * have failed has already been decided.
 */
export function inBackground(work: () => Promise<unknown>): Promise<void> {
  const guarded = work().then(
    () => undefined,
    (err) => {
      console.error("Background work failed:", err instanceof Error ? err.message : err);
    },
  );
  const waitUntil = storage.getStore()?.waitUntil;
  if (waitUntil) {
    waitUntil(guarded);
    return Promise.resolve();
  }
  return guarded;
}

/**
 * Server-Timing header value for this request's stats, plus the total
 * request time. Browsers surface it in DevTools' Timing tab, and Workers
 * Logs get the same numbers as one structured line (see index.ts).
 */
export function serverTimingHeader(stats: RequestStats, totalMs: number): string {
  const airtable = `airtable;dur=${Math.round(stats.airtableMs)};desc="calls=${stats.airtableCalls} bytes=${stats.airtableBytes} 429s=${stats.airtableRateLimited}"`;
  const cache = `cache;desc="hits=${stats.cacheHits} misses=${stats.cacheMisses} kv=${stats.kvHits}"`;
  const total = `total;dur=${Math.round(totalMs)}`;
  return `${airtable}, ${cache}, ${total}`;
}
