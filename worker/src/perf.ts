/**
 * Minimal per-request instrumentation (production telemetry).
 *
 * Emits structured JSON lines to the Worker console so Workers Logs /
 * `wrangler tail` can break down authenticated-request latency:
 *
 *   {"type":"perf.auth", ...}   one line per authorization, with sub-phase
 *                               timings (Supabase verify, People lookup,
 *                               Teams coach-link lookup) and cache flags
 *   {"type":"perf.request",...} one line per HTTP request: total time and
 *                               the exact Airtable call count for it
 *
 * Design notes:
 *  - No auth caching or JWT-verification caching is introduced. The Supabase
 *    /auth/v1/user round-trip stays per-request so token revocation is
 *    immediate (caching it would trade revocation latency for speed).
 *  - Phase timings are wall-clock and can include a few ms of interleaved
 *    concurrent requests in the same isolate; the Airtable call-count delta
 *    is exact per request.
 *  - The browser logs its own request timings via console.debug in
 *    src/lib/apiClient.ts (React Query requests all funnel through it).
 */

const state = { airtableCalls: 0 };

/** Exact count of Airtable HTTP calls made so far in this isolate. */
export function snapshotAirtableCalls(): number {
  return state.airtableCalls;
}

/** Called by the Airtable client on every HTTP request. */
export function countAirtableCall(): void {
  state.airtableCalls += 1;
}

/** Sub-phase breakdown of one authorization (attached to AuthorizedUser). */
export interface AuthPerf {
  supabaseMs: number;
  playerMs: number;
  coachLinksMs: number;
  coachLinksFromCache: boolean;
}

export function logAuthPerf(perf: AuthPerf & { personId: string; role: string }): void {
  console.log(JSON.stringify({ type: "perf.auth", ...perf }));
}

export function logRequestPerf(opts: {
  method: string;
  path: string;
  status: number;
  totalMs: number;
  airtableCalls: number;
}): void {
  console.log(JSON.stringify({ type: "perf.request", ...opts }));
}
