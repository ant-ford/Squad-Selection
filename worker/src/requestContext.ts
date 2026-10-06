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
import type { CacheVersions } from "./cacheVersions";

export interface RequestStats {
  /** Supabase (PostgREST) calls made for this request. */
  dbCalls: number;
  /** Wall time spent waiting on them, in ms (summed across calls), and the response bytes. */
  dbMs: number;
  dbBytes: number;
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
  /** The error behind a 5xx answer, and who was signed in, for error_log (systemHealth.ts). */
  error?: unknown;
  personId?: string;
  /** The signed-in email (auth.ts): whose reused sign-in answer a write drops. */
  email?: string;
  /** The database's cache versions, once this request has read them (auth.ts). */
  versions?: CacheVersions;
  /** The one read of the versions on a request without sign-in (cache.ts requestVersions). */
  versionsRead?: Promise<CacheVersions | null>;
}

/**
 * The request has written to the database (data/supabase.ts): the versions
 * it read before are behind its own write, so they are read again before
 * anything else is cached under them.
 */
export function noteRequestWrite(): void {
  const context = storage.getStore();
  if (!context) return;
  context.versions = undefined;
  context.versionsRead = undefined;
  for (const listener of writeListeners) listener(context);
}

const writeListeners: ((context: RequestContext) => void)[] = [];

/**
 * Called on every database write made inside a request, after the write
 * (auth.ts drops the writer's reused sign-in answer, so their next request
 * reads their own write).
 */
export function onRequestWrite(listener: (context: RequestContext) => void): void {
  writeListeners.push(listener);
}

/** Remembers the error a 5xx answer was made from (index.ts), for error_log. */
export function noteRequestError(err: unknown): void {
  const context = storage.getStore();
  if (context) context.error = err;
}

/** Remembers who is signed in (auth.ts), for error_log. */
export function noteRequestPerson(personId: string, email?: string): void {
  const context = storage.getStore();
  if (!context) return;
  context.personId = personId;
  if (email) context.email = email;
}

/** Remembers the cache versions read with the person (auth.ts), for the caches later in the request. */
export function noteRequestVersions(versions: CacheVersions): void {
  const context = storage.getStore();
  if (context) context.versions = versions;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function newRequestStats(): RequestStats {
  return {
    dbCalls: 0,
    dbMs: 0,
    dbBytes: 0,
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

export function recordDbCall(ms: number, bytes: number): void {
  const stats = storage.getStore()?.stats;
  if (!stats) return;
  stats.dbCalls += 1;
  stats.dbMs += ms;
  stats.dbBytes += bytes;
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
  const cache = `cache;desc="hits=${stats.cacheHits} misses=${stats.cacheMisses} kv=${stats.kvHits}"`;
  const total = `total;dur=${Math.round(totalMs)}`;
  // Only when the request used the database.
  const db = stats.dbCalls > 0 ? `db;dur=${Math.round(stats.dbMs)};desc="calls=${stats.dbCalls} bytes=${stats.dbBytes}", ` : "";
  return `${db}${cache}, ${total}`;
}
