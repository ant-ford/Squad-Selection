import { SupabaseError } from "./data/supabase";
import { sendDueReviewEmails } from "./reviewEmails";
import { RETENTION_CRON, runRetention } from "./retention";
import type { Env } from "./env";
import { errorJson, handleOptions, HttpError, parseAllowedOrigins, resolveOrigin } from "./http";
import { refreshUmpirePool } from "./umpiring";
import { dispatch } from "./router";
import { GUARDED_SCOPES, ROUTES } from "./routes";
import { newRequestStats, noteRequestError, runWithRequestContext, serverTimingHeader, type RequestContext } from "./requestContext";
import { READ_ONLY_CODE, READ_ONLY_MESSAGE, writesOff } from "./readOnly";
import { HEALTH_CRON, logServerError, runHealthCron, withHeartbeat } from "./systemHealth";

export type { Env };

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    if (parseAllowedOrigins(env.ALLOWED_ORIGIN).length === 0) {
      console.error("Server misconfigured: ALLOWED_ORIGIN is not set");
      return new Response(
        JSON.stringify({ error: "SERVER_MISCONFIGURED", message: "Server misconfigured: ALLOWED_ORIGIN is not set" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    // Every request runs inside its own context (requestContext.ts): the
    // database client and the caches count what they do into it, and cache
    // invalidation can hand slow KV housekeeping to ctx.waitUntil. The
    // numbers go out as a Server-Timing header, readable in the browser's
    // Timing tab, and as one structured log line per request in Workers
    // Logs - the "is it the database or is it us" question, answered per call.
    const stats = newRequestStats();
    const startedAt = Date.now();
    const waitUntil = ctx?.waitUntil ? (p: Promise<unknown>) => ctx.waitUntil(p) : undefined;
    const context: RequestContext = { stats, waitUntil };
    return runWithRequestContext(context, async () => {
      let response: Response;
      try {
        response = await handleRequest(request, env);
      } catch (err) {
        console.error("Unhandled worker error:", err instanceof Error ? err.stack : err);
        noteRequestError(err);
        response = errorJson("Internal Server Error", 500, resolveOrigin(request, env.ALLOWED_ORIGIN));
      }
      const totalMs = Date.now() - startedAt;
      const { pathname } = new URL(request.url);
      // Every 5xx goes into error_log after the response (systemHealth.ts),
      // except while writes are off (readOnly.ts): that log is a write too.
      if (response.status >= 500 && waitUntil && !writesOff(env)) {
        const { error, personId } = context;
        const copy = error === undefined ? response.clone() : null;
        waitUntil(logServerError(env, { route: pathname, status: response.status, requestId: request.headers.get("cf-ray"), error, personId, response: copy }));
      }
      if (pathname !== "/health") {
        console.log(
          "request " +
            JSON.stringify({
              method: request.method,
              path: pathname,
              status: response.status,
              ms: totalMs,
              ...(stats.dbCalls > 0 ? { dbCalls: stats.dbCalls, dbMs: Math.round(stats.dbMs), dbBytes: stats.dbBytes } : {}),
              cacheHits: stats.cacheHits,
              cacheMisses: stats.cacheMisses,
              kvHits: stats.kvHits,
            }),
        );
      }
      const timed = new Response(response.body, response);
      timed.headers.set("Server-Timing", serverTimingHeader(stats, totalMs));
      // Without this a cross-origin caller (the app) cannot read the header.
      timed.headers.set("Timing-Allow-Origin", resolveOrigin(request, env.ALLOWED_ORIGIN));
      return timed;
    });
  },

  /**
   * Daily: send the commitment review emails that are due (reviewEmails.ts)
   * - the job the Airtable 60-day automation did.
   * RETENTION_CRON, half an hour later, is the data retention job
   * (retention.ts), on its own so it has a run's outside calls to itself.
   */
  async scheduled(event: { cron: string }, env: Env): Promise<void> {
    // Every job writes (heartbeats, emails, retention), so while writes are
    // off (readOnly.ts) none of them runs, the health check included.
    if (writesOff(env)) {
      console.log(`cron ${event.cron} skipped: WRITES is off`);
      return;
    }
    // HEALTH_CRON: the daily system health check (systemHealth.ts). Each job
    // records a heartbeat, which is what that check reads.
    if (event.cron === HEALTH_CRON) {
      await runHealthCron(env);
      // The umpire pool auth_context reads: someone known only by their
      // name on a match card sees the umpiring screen within a day.
      try {
        await refreshUmpirePool(env);
      } catch (err) {
        console.error("Umpire pool not refreshed:", err instanceof Error ? err.message : err);
      }
      return;
    }
    if (event.cron === RETENTION_CRON) {
      await withHeartbeat(env, "retention", () => runRetention(env));
      return;
    }
    await withHeartbeat(env, "review-emails", () => sendDueReviewEmails(env));
  },
};

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const origin = resolveOrigin(request, env.ALLOWED_ORIGIN);
  const url = new URL(request.url);
  const method = request.method;

  if (method === "OPTIONS") return handleOptions(origin);
  // The read-only switch (readOnly.ts): every save is turned away here,
  // before sign-in, so it costs no subrequests. GETs carry on, the calendar
  // feeds and signed file links among them.
  if (method !== "GET" && method !== "HEAD" && writesOff(env)) {
    return errorJson(READ_ONLY_MESSAGE, 503, origin, READ_ONLY_CODE);
  }

  try {
    // Every route, its guard and its handler: routes.ts (router.ts dispatches).
    return await dispatch(ROUTES, GUARDED_SCOPES, request, env, url, origin);
  } catch (err) {
    if (err instanceof HttpError) return errorJson(err.message, err.status, origin, err.code);
    noteRequestError(err); // for error_log: every branch below is a 5xx
    if (err instanceof SupabaseError) {
      // Which table, status and code - enough to diagnose from the screen,
      // never the database's message, which can quote a value.
      console.error("Supabase error:", err.message);
      const table = /^Supabase \w+ (\S+) failed/.exec(err.message)?.[1] ?? "?";
      return errorJson(`Database error (${table}, ${err.status}${err.code ? ` ${err.code}` : ""}). Please try again.`, 502, origin, "DB_ERROR");
    }

    console.error("Unhandled worker error:", err instanceof Error ? err.stack : err);
    return errorJson("Internal Server Error", 500, origin);
  }
}
