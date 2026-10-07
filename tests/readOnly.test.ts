import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The read-only switch for a restore (worker/src/readOnly.ts, docs/RESTORE.md).
// WRITES = "off" turns every save away with 503 READ_ONLY before sign-in, so
// it makes no outside call at all, and skips the daily jobs. Reads carry on.
// Unset or "on" changes nothing.

const mocks = vi.hoisted(() => ({
  sendDueReviewEmails: vi.fn(async () => ({ sent: 0 })),
  runRetention: vi.fn(async () => ({ removed: 0 })),
  runHealthCron: vi.fn(async () => ({ ok: true, checks: [], emailed: false })),
  withHeartbeat: vi.fn(async (_env: unknown, _job: string, run: () => Promise<unknown>) => run()),
  logServerError: vi.fn(async () => {}),
  refreshUmpirePool: vi.fn(async () => {}),
  handlePlayerCalendarFeed: vi.fn(async () => new Response("BEGIN:VCALENDAR", { status: 200, headers: { "Content-Type": "text/calendar" } })),
  handleFileRequest: vi.fn(async () => new Response("file", { status: 200 })),
}));

vi.mock("../worker/src/reviewEmails", () => ({ sendDueReviewEmails: mocks.sendDueReviewEmails }));
vi.mock("../worker/src/retention", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../worker/src/retention")>()),
  runRetention: mocks.runRetention,
}));
vi.mock("../worker/src/systemHealth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../worker/src/systemHealth")>()),
  runHealthCron: mocks.runHealthCron,
  withHeartbeat: mocks.withHeartbeat,
  logServerError: mocks.logServerError,
}));
vi.mock("../worker/src/umpiring", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../worker/src/umpiring")>()),
  refreshUmpirePool: mocks.refreshUmpirePool,
}));
vi.mock("../worker/src/calendar", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../worker/src/calendar")>()),
  handlePlayerCalendarFeed: mocks.handlePlayerCalendarFeed,
}));
vi.mock("../worker/src/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../worker/src/files")>()),
  handleFileRequest: mocks.handleFileRequest,
}));

import worker from "../worker/src/index";
import { RETENTION_CRON } from "../worker/src/retention";
import { HEALTH_CRON } from "../worker/src/systemHealth";
import type { Env } from "../worker/src/env";

const ORIGIN = "https://app.test";
const BASE = {
  CALENDAR_SECRET: "test-secret",
  ALLOWED_ORIGIN: ORIGIN,
  SUPABASE_URL: "https://auth.test",
  SUPABASE_ANON_KEY: "anon",
  DATA_SUPABASE_URL: "https://data.test",
  DATA_SUPABASE_SECRET_KEY: "secret",
} as unknown as Env;
const OFF = { ...BASE, WRITES: "off" } as Env;

const ctx = () => {
  const pending: Promise<unknown>[] = [];
  return { waitUntil: (p: Promise<unknown>) => void pending.push(p), pending } as unknown as ExecutionContext & { pending: Promise<unknown>[] };
};

/** Any outside call (Supabase, sign-in, Resend) fails the test that makes it. */
const outside = vi.fn(async () => {
  throw new Error("unexpected outside call");
});

beforeEach(() => {
  vi.stubGlobal("fetch", outside);
  outside.mockClear();
  Object.values(mocks).forEach((m) => m.mockClear());
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const request = (method: string, path: string, init: RequestInit = {}) =>
  new Request(`https://api.test${path}`, {
    method,
    headers: { Origin: ORIGIN, Authorization: "Bearer some.jwt", "Content-Type": "application/json" },
    ...(method === "GET" || method === "HEAD" || method === "OPTIONS" ? {} : { body: "{}" }),
    ...init,
  });

describe("WRITES = off", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])("answers %s with 503 READ_ONLY, before sign-in", async (method) => {
    const c = ctx();
    const res = await worker.fetch(request(method, "/api/set-my-availability"), OFF, c);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "READ_ONLY", message: expect.stringMatching(/read-only/) });
    // The browser can read it: the usual CORS headers are on it.
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    // No sign-in check, no database, and no error_log row (that is a write too).
    expect(outside).not.toHaveBeenCalled();
    await Promise.all(c.pending);
    expect(mocks.logServerError).not.toHaveBeenCalled();
  });

  it("turns away a save on any route, the admin ones and the crash report included", async () => {
    for (const path of ["/api/squad/changes", "/api/admin/people/x", "/api/client-error", "/api/join/register"]) {
      const res = await worker.fetch(request("POST", path), OFF, ctx());
      expect(res.status, path).toBe(503);
    }
    expect(outside).not.toHaveBeenCalled();
  });

  it("leaves the CORS preflight alone", async () => {
    const res = await worker.fetch(request("OPTIONS", "/api/set-my-availability"), OFF, ctx());
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("still answers GETs: /health (which says so), the calendar feeds and signed file links", async () => {
    const health = await worker.fetch(request("GET", "/health"), OFF, ctx());
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: "ok", writes: "off" });

    const feed = await worker.fetch(request("GET", "/api/calendar/feed.ics?id=x&sig=y"), OFF, ctx());
    expect(feed.status).toBe(200);
    expect(mocks.handlePlayerCalendarFeed).toHaveBeenCalledTimes(1);

    const file = await worker.fetch(request("GET", "/api/files/00000000-0000-4000-8000-000000000000?sig=x"), OFF, ctx());
    expect(file.status).toBe(200);
    expect(mocks.handleFileRequest).toHaveBeenCalledTimes(1);
  });

  it("lets a signed-in GET through to sign-in, rather than turning it away", async () => {
    // The fake fetch refuses sign-in, so this ends in AUTH_UNAVAILABLE; the
    // point is that it got past the switch and tried.
    const res = await worker.fetch(request("GET", "/api/my-profile"), OFF, ctx());
    expect(res.status).not.toBe(404);
    expect(((await res.json()) as { error?: string }).error).not.toBe("READ_ONLY");
    expect(outside).toHaveBeenCalled();
  });

  it.each([["review emails", "0 3 * * *"], ["retention", RETENTION_CRON], ["health check", HEALTH_CRON]])(
    "skips the %s cron",
    async (_name, cron) => {
      await worker.scheduled({ cron }, OFF);
      expect(mocks.sendDueReviewEmails).not.toHaveBeenCalled();
      expect(mocks.runRetention).not.toHaveBeenCalled();
      expect(mocks.runHealthCron).not.toHaveBeenCalled();
      expect(mocks.refreshUmpirePool).not.toHaveBeenCalled();
      expect(mocks.withHeartbeat).not.toHaveBeenCalled();
      expect(outside).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("skipped: WRITES is off"));
    },
  );
});

describe("WRITES unset or on (the default)", () => {
  it.each([["unset", BASE], ["on", { ...BASE, WRITES: "on" } as Env]])("lets a save through when %s", async (_label, env) => {
    // No Authorization header: sign-in refuses it, which shows it passed the switch.
    const res = await worker.fetch(request("POST", "/api/set-my-availability", { headers: { Origin: ORIGIN } }), env, ctx());
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error?: string }).error).toBe("UNAUTHORIZED");
  });

  it("does not mention writes on /health", async () => {
    const res = await worker.fetch(request("GET", "/health"), BASE, ctx());
    expect(await res.json()).not.toHaveProperty("writes");
  });

  it("runs the crons", async () => {
    await worker.scheduled({ cron: "0 3 * * *" }, BASE);
    expect(mocks.sendDueReviewEmails).toHaveBeenCalledTimes(1);
    await worker.scheduled({ cron: RETENTION_CRON }, BASE);
    expect(mocks.runRetention).toHaveBeenCalledTimes(1);
    await worker.scheduled({ cron: HEALTH_CRON }, BASE);
    expect(mocks.runHealthCron).toHaveBeenCalledTimes(1);
  });
});
