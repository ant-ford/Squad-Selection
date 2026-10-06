import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import {
  ALERT_JOB,
  CLIENT_ERRORS_PER_HOUR,
  CLIENT_ERROR_MAX_BYTES,
  EMAIL_RESERVE,
  SERVER_ERROR_THRESHOLD,
  allowClientError,
  canViewSystem,
  evaluateHealth,
  isSystemOwner,
  logClientError,
  logServerError,
  readClientError,
  resetClientErrorLimiter,
  scrub,
  shouldAlert,
  withHeartbeat,
  type HealthSnapshot,
  type JobRow,
} from "../worker/src/systemHealth";
import { DAILY_LIMIT } from "../worker/src/mailer";
import worker from "../worker/src/index";

const NOW = new Date("2026-10-07T04:00:00Z");
const hoursBefore = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
const job = (name: string, h: number, ok = true, lastOkH: number | null = ok ? h : null): JobRow => ({
  job: name,
  ran_at: hoursBefore(h),
  ok,
  detail: null,
  last_ok_at: lastOkH === null ? null : hoursBefore(lastOkH),
});

function healthy(over: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    now: NOW.toISOString(),
    jobs: [job("backup", 9), job("hkha-sync", 3), job("review-emails", 1), job("retention", 0.5), job("health-check", 24)],
    server_errors_24h: 0,
    client_errors_24h: 0,
    sync_errors: 0,
    last_match_at: null,
    ...over,
  };
}
const failed = (snap: HealthSnapshot, skip?: string[]) =>
  evaluateHealth(snap, { now: NOW, skip }).checks.filter((c) => !c.ok).map((c) => c.key);

describe("evaluateHealth", () => {
  it("passes when every job ran recently and nothing failed", () => {
    const result = evaluateHealth(healthy(), { now: NOW });
    expect(result.ok).toBe(true);
    expect(result.checks.map((c) => c.key)).toEqual(["backup", "hkha-sync", "review-emails", "retention", "health-check", "sync-errors", "server-errors"]);
  });

  it("fails a backup over 30 hours old, but not one at 29", () => {
    const jobs = (h: number) => healthy().jobs.map((j) => (j.job === "backup" ? job("backup", h) : j));
    expect(failed(healthy({ jobs: jobs(31) }))).toEqual(["backup"]);
    expect(failed(healthy({ jobs: jobs(29) }))).toEqual([]);
  });

  it("fails a job that never ran, and one whose last run failed", () => {
    const jobs = healthy().jobs.filter((j) => j.job !== "retention").map((j) => (j.job === "review-emails" ? job("review-emails", 1, false, 25) : j));
    const result = evaluateHealth(healthy({ jobs }), { now: NOW });
    expect(result.checks.find((c) => c.key === "retention")).toMatchObject({ ok: false, note: "never ran" });
    expect(result.checks.find((c) => c.key === "review-emails")).toMatchObject({ ok: false, note: "failed 1h ago" });
  });

  it("leaves out skipped jobs (the health check, when it is the one running)", () => {
    const jobs = healthy().jobs.filter((j) => j.job !== "health-check");
    expect(failed(healthy({ jobs }))).toEqual(["health-check"]);
    expect(failed(healthy({ jobs }), ["health-check"])).toEqual([]);
  });

  it("on a match day, needs a good hkha-sync run since the match ended", () => {
    const match = hoursBefore(20); // ended 18h ago
    const sync = (lastOkH: number) => healthy().jobs.map((j) => (j.job === "hkha-sync" ? job("hkha-sync", 3, false, lastOkH) : j));
    // The latest run failed, and the last good one was before the match ended.
    expect(failed(healthy({ last_match_at: match, jobs: sync(19) }))).toEqual(["hkha-sync", "match-day-sync"]);
    // The latest run failed, but one after the match worked: only the job shows.
    expect(failed(healthy({ last_match_at: match, jobs: sync(10) }))).toEqual(["hkha-sync"]);
    expect(failed(healthy({ last_match_at: match }))).toEqual([]);
  });

  it("fails on match cards hkha-sync couldn't read", () => {
    const result = evaluateHealth(healthy({ sync_errors: 2 }), { now: NOW });
    expect(result.checks.find((c) => c.key === "sync-errors")).toMatchObject({ ok: false, note: "2 failed" });
  });

  it("fails above the 5xx threshold, not at it", () => {
    expect(failed(healthy({ server_errors_24h: SERVER_ERROR_THRESHOLD }))).toEqual([]);
    expect(failed(healthy({ server_errors_24h: SERVER_ERROR_THRESHOLD + 1 }))).toEqual(["server-errors"]);
  });
});

describe("the owner's alert", () => {
  it("goes at most once a day", () => {
    expect(shouldAlert(healthy(), 0, NOW)).toBe(true);
    expect(shouldAlert(healthy({ jobs: [job(ALERT_JOB, 5)] }), 0, NOW)).toBe(false);
    expect(shouldAlert(healthy({ jobs: [job(ALERT_JOB, 23)] }), 0, NOW)).toBe(true);
  });

  it("never takes the day's last emails", () => {
    expect(shouldAlert(healthy(), DAILY_LIMIT - EMAIL_RESERVE - 1, NOW)).toBe(true);
    expect(shouldAlert(healthy(), DAILY_LIMIT - EMAIL_RESERVE, NOW)).toBe(false);
  });
});

describe("who sees it", () => {
  const env = { SYSTEM_OWNER_IDS: "recOwner, recOther" } as Env;
  it("matches the signed-in person's People api_id", () => {
    expect(isSystemOwner(env, { personId: "recOwner" })).toBe(true);
    expect(isSystemOwner(env, { personId: "recOther" })).toBe(true);
    expect(isSystemOwner(env, { personId: "recSomeone" })).toBe(false);
    expect(isSystemOwner({} as Env, { personId: "recOwner" })).toBe(false);
  });
  it("lets the Section Captains open /system", () => {
    expect(canViewSystem(env, { personId: "recX", officerRoles: [{ office: "sectionCaptain", designation: "" }] })).toBe(true);
    expect(canViewSystem(env, { personId: "recX", officerRoles: [{ office: "membershipOfficer", designation: "" }] })).toBe(false);
    expect(canViewSystem(env, { personId: "recOwner", officerRoles: [] })).toBe(true);
  });
});

const dataEnv = {
  ALLOWED_ORIGIN: "https://app.example.com",
  DATA_BACKEND: "supabase",
  DATA_SUPABASE_URL: "https://proj.supabase.co",
  DATA_SUPABASE_SECRET_KEY: "sb_secret_test",
} as Env;

type Call = { path: string; method: string; body: any };
function fakeDb(reply: (c: Call) => unknown = () => []) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const c = { path: url.pathname, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    return new Response(JSON.stringify(reply(c)), { status: 200 });
  }));
  return calls;
}

beforeEach(() => resetClientErrorLimiter());
afterEach(() => vi.unstubAllGlobals());

describe("client error rate limit", () => {
  it("allows CLIENT_ERRORS_PER_HOUR a person an hour", () => {
    const t = Date.parse("2026-10-07T00:00:00Z");
    for (let i = 0; i < CLIENT_ERRORS_PER_HOUR; i++) expect(allowClientError("p1", t + i)).toBe(true);
    expect(allowClientError("p1", t + 1000)).toBe(false);
    // Someone else is counted separately.
    expect(allowClientError("p2", t + 1000)).toBe(true);
    // An hour after the first, one more.
    expect(allowClientError("p1", t + 3600_000)).toBe(true);
    expect(allowClientError("p1", t + 3600_000)).toBe(false);
  });

  it("stops at the limit without asking the database", async () => {
    const calls = fakeDb(() => true);
    const report = { kind: "error", message: "boom", route: "/", stack: "" };
    for (let i = 0; i < CLIENT_ERRORS_PER_HOUR; i++) expect(await logClientError(dataEnv, { personId: "p1" }, report)).toEqual({ logged: true });
    expect(await logClientError(dataEnv, { personId: "p1" }, report)).toEqual({ logged: false });
    expect(calls).toHaveLength(CLIENT_ERRORS_PER_HOUR);
    expect(calls[0].path).toBe("/rest/v1/rpc/log_client_error");
    expect(calls[0].body).toMatchObject({ p_person: "p1", p_limit: CLIENT_ERRORS_PER_HOUR, p_detail: { kind: "error" } });
  });

  it("never fails the request when the write fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await logClientError(dataEnv, { personId: "p1" }, { kind: "error", message: "x", route: "/", stack: "" })).toEqual({ logged: false });
  });

  it("blanks email addresses in what it keeps", async () => {
    const calls = fakeDb(() => true);
    await logClientError(dataEnv, { personId: "p1" }, { kind: "error", message: "No user jo.bloggs@example.com", route: "/", stack: "" });
    expect(calls[0].body.p_message).toBe("No user [email]");
  });
});

describe("reading a crash report", () => {
  const post = (body: string, headers: Record<string, string> = {}) =>
    new Request("https://api.example.com/api/client-error", { method: "POST", body, headers });

  it("refuses a body over the size limit", async () => {
    const big = JSON.stringify({ message: "x".repeat(CLIENT_ERROR_MAX_BYTES) });
    await expect(readClientError(post(big))).rejects.toMatchObject({ status: 413 });
  });

  it("keeps the path only, and a known kind", async () => {
    const r = await readClientError(post(JSON.stringify({ kind: "nonsense", message: "m", route: "/review/1?token=abc#x" })));
    expect(r).toEqual({ kind: "error", message: "m", route: "/review/1", stack: "" });
  });
});

describe("Worker 5xx logging", () => {
  it("writes one error_log row, and never throws when that write fails", async () => {
    const calls = fakeDb();
    await logServerError(dataEnv, { route: "/api/x", status: 500, requestId: "ray-1", error: new Error("bad thing for a@b.com"), personId: "p1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ path: "/rest/v1/error_log", method: "POST" });
    expect(calls[0].body[0]).toMatchObject({ source: "worker", route: "/api/x", status: 500, message: "Error: bad thing for [email]", person_id: "p1", request_id: "ray-1" });

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("database down"); }));
    await expect(logServerError(dataEnv, { route: "/api/x", status: 502, requestId: null })).resolves.toBeUndefined();
  });

  it("logs a 5xx answer from the top-level handler after the response", async () => {
    const calls = fakeDb();
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
    // No SUPABASE_URL: sign-in can't be checked, a 500 (auth.ts).
    const response = await worker.fetch(
      new Request("https://api.example.com/api/my-tasks", { headers: { Authorization: "Bearer t", Origin: "https://app.example.com" } }),
      dataEnv,
      ctx,
    );
    expect(response.status).toBe(500);
    await Promise.all(pending);
    const rows = calls.filter((c) => c.path === "/rest/v1/error_log");
    expect(rows).toHaveLength(1);
    expect(rows[0].body[0]).toMatchObject({ source: "worker", route: "/api/my-tasks", status: 500, message: "Server authentication not configured" });
  });

  it("doesn't log 4xx answers", async () => {
    const calls = fakeDb();
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
    const response = await worker.fetch(new Request("https://api.example.com/api/my-tasks"), dataEnv, ctx);
    expect(response.status).toBe(401);
    await Promise.all(pending);
    expect(calls.filter((c) => c.path === "/rest/v1/error_log")).toHaveLength(0);
  });
});

describe("cron heartbeats", () => {
  it("records ok with the result, or a failure and throws on", async () => {
    const calls = fakeDb();
    await withHeartbeat(dataEnv, "retention", async () => ({ removed: 1, failed: 0 }));
    expect(calls[0].body[0]).toMatchObject({ job: "retention", ok: true, detail: { removed: 1, failed: 0 } });
    await withHeartbeat(dataEnv, "review-emails", async () => ({ sent: 1, failed: 2 }));
    expect(calls[1].body[0]).toMatchObject({ job: "review-emails", ok: false });
    await expect(withHeartbeat(dataEnv, "retention", async () => { throw new Error("nope"); })).rejects.toThrow("nope");
    expect(calls[2].body[0]).toMatchObject({ job: "retention", ok: false, detail: { error: "Error: nope" } });
  });
});

describe("scrub", () => {
  it("blanks addresses and caps the length", () => {
    expect(scrub("mail Jo.Smith+x@hkfc.com.hk now", 100)).toBe("mail [email] now");
    expect(scrub("abcdef", 3)).toBe("abc");
  });
});
