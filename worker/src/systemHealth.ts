/**
 * System health (migration 20261007000202_system_health.sql). The owner can't
 * tail the Worker's logs, so failures are written where Eddy can show them:
 *
 *  - error_log: every 5xx the Worker answers (index.ts, after the response
 *    has gone), and crashes the app reports (POST /api/client-error,
 *    signed-in only, rate-limited, size-limited). No personal data beyond
 *    the person's id; email addresses in messages are blanked.
 *  - heartbeats: one row per run of each scheduled job. The Worker's crons
 *    write their own (withHeartbeat); the nightly backup and hkha-sync write
 *    theirs from GitHub Actions.
 *
 * The daily HEALTH_CRON checks them (evaluateHealth) and, when something is
 * wrong, emails the owner once (after the review emails, never into the
 * last few of the day's email allowance). The owner also gets a System line
 * in My Tasks, which opens /system. The owner is SYSTEM_OWNER_EMAIL; the
 * Section Captains can open /system too.
 *
 * GitHub turns off scheduled workflows in a public repository after 60 days
 * without activity, so the backup and hkha-sync can stop without a failure
 * anywhere. Their heartbeats going stale is how that shows up.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { db, eq, SupabaseError } from "./data/supabase";
import { HttpError } from "./http";
import { DAILY_LIMIT, sendEmail } from "./mailer";
import { getCached } from "./cache";
import { normalizeEmail } from "../../shared/normalizeEmail";

/** The health check's own cron (worker/wrangler.toml [triggers]): after the review emails (03:00) and retention (03:30). */
export const HEALTH_CRON = "0 4 * * *";
export const HEALTH_JOB = "health-check";
/** A heartbeat written when the owner has been emailed, so it happens at most once a day. */
export const ALERT_JOB = "health-alert";

/** The jobs that must have run recently, and how recently (hours). */
export const EXPECTED_JOBS: readonly { job: string; label: string; maxHours: number }[] = [
  { job: "backup", label: "Backup", maxHours: 30 },
  { job: "hkha-sync", label: "HKHA sync", maxHours: 26 },
  { job: "review-emails", label: "Review emails", maxHours: 26 },
  { job: "retention", label: "Retention", maxHours: 26 },
  { job: HEALTH_JOB, label: "Health check", maxHours: 26 },
];

/** More 5xx answers than this in 24 hours is a failure. */
export const SERVER_ERROR_THRESHOLD = 10;
/** hkha-sync should have finished a run this long after a match started. */
const MATCH_LENGTH_HOURS = 2;
/** The alert is skipped when the day's email count is this close to the mailer's cap. */
export const EMAIL_RESERVE = 10;
/** Client crash reports per person per hour. */
export const CLIENT_ERRORS_PER_HOUR = 10;
/** A crash report's body, in bytes. */
export const CLIENT_ERROR_MAX_BYTES = 4096;
/** Worker 5xx rows written per isolate per minute, so an outage can't flood the table. */
const SERVER_ERRORS_PER_MINUTE = 20;

const HOUR = 60 * 60 * 1000;

export interface JobRow {
  job: string;
  ran_at: string;
  ok: boolean;
  detail: unknown;
  last_ok_at: string | null;
}

/** public.system_health_snapshot(). */
export interface HealthSnapshot {
  now: string;
  jobs: JobRow[];
  server_errors_24h: number;
  client_errors_24h: number;
  sync_errors: number;
  last_match_at: string | null;
}

export interface HealthCheck {
  key: string;
  label: string;
  ok: boolean;
  note?: string;
}

const hoursAgo = (iso: string, now: Date) => (now.getTime() - new Date(iso).getTime()) / HOUR;
const ago = (iso: string, now: Date) => {
  const h = hoursAgo(iso, now);
  return h < 48 ? `${Math.max(0, Math.round(h))}h ago` : `${Math.round(h / 24)}d ago`;
};

/**
 * The checks, from a snapshot. Pure. `skip` leaves jobs out: the health
 * check itself, when it is the one running.
 */
export function evaluateHealth(snapshot: HealthSnapshot, opts: { now: Date; skip?: string[] }): { ok: boolean; checks: HealthCheck[] } {
  const { now } = opts;
  const byJob = new Map(snapshot.jobs.map((j) => [j.job, j]));
  const checks: HealthCheck[] = [];

  for (const { job, label, maxHours } of EXPECTED_JOBS) {
    if (opts.skip?.includes(job)) continue;
    const last = byJob.get(job);
    if (!last) checks.push({ key: job, label, ok: false, note: "never ran" });
    else if (!last.ok) checks.push({ key: job, label, ok: false, note: `failed ${ago(last.ran_at, now)}` });
    else if (hoursAgo(last.ran_at, now) > maxHours) checks.push({ key: job, label, ok: false, note: `last ran ${ago(last.ran_at, now)}` });
    else checks.push({ key: job, label, ok: true, note: ago(last.ran_at, now) });
  }

  // A match day: hkha-sync must have run successfully since the match ended.
  if (snapshot.last_match_at) {
    const ended = new Date(snapshot.last_match_at).getTime() + MATCH_LENGTH_HOURS * HOUR;
    const lastOk = byJob.get("hkha-sync")?.last_ok_at;
    const synced = !!lastOk && new Date(lastOk).getTime() > ended;
    checks.push({ key: "match-day-sync", label: "Results synced", ok: synced, note: synced ? undefined : "no sync since the last match" });
  }

  checks.push({
    key: "sync-errors",
    label: "Match cards",
    ok: snapshot.sync_errors === 0,
    note: snapshot.sync_errors === 0 ? undefined : `${snapshot.sync_errors} failed`,
  });
  checks.push({
    key: "server-errors",
    label: "Server errors",
    ok: snapshot.server_errors_24h <= SERVER_ERROR_THRESHOLD,
    note: `${snapshot.server_errors_24h} in 24h`,
  });

  return { ok: checks.every((c) => c.ok), checks };
}

// ── Who ───────────────────────────────────────────────────────────────────

/** SYSTEM_OWNER_EMAIL, comma-separated; the first is where alerts go. */
export function ownerEmails(env: Pick<Env, "SYSTEM_OWNER_EMAIL">): string[] {
  return (env.SYSTEM_OWNER_EMAIL ?? "").split(",").map(normalizeEmail).filter(Boolean);
}

export function isSystemOwner(env: Pick<Env, "SYSTEM_OWNER_EMAIL">, user: Pick<AuthorizedUser, "email">): boolean {
  return ownerEmails(env).includes(normalizeEmail(user.email));
}

/** The owner, and the Section Captains (the officers' table, as for the officers' sections in auth.ts). */
export function canViewSystem(env: Pick<Env, "SYSTEM_OWNER_EMAIL">, user: Pick<AuthorizedUser, "email" | "officerRoles">): boolean {
  return isSystemOwner(env, user) || user.officerRoles.some((r) => r.office === "sectionCaptain");
}

// ── Writing ───────────────────────────────────────────────────────────────

const configured = (env: Env) => !!env.DATA_SUPABASE_URL && !!env.DATA_SUPABASE_SECRET_KEY;

/** Email addresses blanked, length capped. */
export function scrub(text: string, max: number): string {
  return text.replace(/[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[a-z]{2,}/gi, "[email]").slice(0, max);
}

/** A heartbeat row. Never throws: a job's result never depends on it. */
export async function recordHeartbeat(env: Env, job: string, ok: boolean, detail?: unknown): Promise<void> {
  if (!configured(env)) return;
  try {
    await db(env).insert("heartbeats", [{ job, ok, detail: detail ?? null }]);
  } catch (err) {
    console.error(`Heartbeat for ${job} not recorded:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Runs a cron job and records its heartbeat: ok unless it threw or reports
 * `failed` items. A throw is recorded, then thrown on.
 */
export async function withHeartbeat<T>(env: Env, job: string, run: () => Promise<T>): Promise<T> {
  try {
    const result = await run();
    const failed = (result as { failed?: unknown } | undefined)?.failed;
    await recordHeartbeat(env, job, !(typeof failed === "number" && failed > 0), result ?? null);
    return result;
  } catch (err) {
    await recordHeartbeat(env, job, false, { error: scrub(errorText(err), 300) });
    throw err;
  }
}

function errorText(err: unknown): string {
  if (err instanceof SupabaseError) {
    // Which table, status and code; never the database's message (index.ts).
    const table = /^Supabase \w+ (\S+) failed/.exec(err.message)?.[1] ?? "?";
    return `Database error (${table}, ${err.status}${err.code ? ` ${err.code}` : ""})`;
  }
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

let serverErrorWindow: number[] = [];

/** Per isolate: at most SERVER_ERRORS_PER_MINUTE rows a minute. */
export function takeServerErrorSlot(nowMs = Date.now()): boolean {
  serverErrorWindow = serverErrorWindow.filter((t) => nowMs - t < 60_000);
  if (serverErrorWindow.length >= SERVER_ERRORS_PER_MINUTE) return false;
  serverErrorWindow.push(nowMs);
  return true;
}

/**
 * One 5xx answer, into error_log. Called through ctx.waitUntil after the
 * response has gone (index.ts). Never throws, and writes straight to the
 * database, so a failed write can't come back through the Worker.
 */
export async function logServerError(
  env: Env,
  entry: { route: string; status: number; requestId: string | null; error?: unknown; personId?: string; response?: Response | null },
): Promise<void> {
  try {
    if (!configured(env) || !takeServerErrorSlot()) return;
    let message: string;
    let detail: Record<string, unknown> | null = null;
    if (entry.error !== undefined) {
      message = errorText(entry.error);
      if (entry.error instanceof Error && !(entry.error instanceof SupabaseError) && entry.error.stack) {
        detail = { stack: scrub(entry.error.stack.split("\n").slice(1, 6).join("\n"), 1000) };
      }
    } else {
      // The answer's own message (http.ts errorJson), written for the screen.
      const body = (await entry.response?.json().catch(() => null)) as { message?: unknown; error?: unknown } | null;
      message = typeof body?.message === "string" ? body.message : `HTTP ${entry.status}`;
      if (typeof body?.error === "string") detail = { code: body.error };
    }
    await db(env).insert("error_log", [{
      source: "worker",
      route: entry.route.slice(0, 200),
      status: entry.status,
      message: scrub(message, 500),
      person_id: entry.personId ?? null,
      request_id: entry.requestId?.slice(0, 100) ?? null,
      detail,
    }]);
  } catch (err) {
    console.error("error_log write failed:", err instanceof Error ? err.message : err);
  }
}

// ── Crashes the app reports ───────────────────────────────────────────────

const clientWindows = new Map<string, number[]>();

/** Per isolate, before the database's own count: at most CLIENT_ERRORS_PER_HOUR a person an hour. */
export function allowClientError(personId: string, nowMs = Date.now()): boolean {
  if (clientWindows.size > 1000) clientWindows.clear();
  const recent = (clientWindows.get(personId) ?? []).filter((t) => nowMs - t < HOUR);
  if (recent.length >= CLIENT_ERRORS_PER_HOUR) {
    clientWindows.set(personId, recent);
    return false;
  }
  recent.push(nowMs);
  clientWindows.set(personId, recent);
  return true;
}

export function resetClientErrorLimiter(): void {
  clientWindows.clear();
  serverErrorWindow = [];
}

const KINDS = new Set(["route", "error", "rejection"]);

/** The report, at most CLIENT_ERROR_MAX_BYTES; 413 otherwise. */
export async function readClientError(request: Request): Promise<{ kind: string; message: string; route: string; stack: string }> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > CLIENT_ERROR_MAX_BYTES) throw new HttpError("Too large", 413, "TOO_LARGE");
  const text = await request.text();
  if (text.length > CLIENT_ERROR_MAX_BYTES) throw new HttpError("Too large", 413, "TOO_LARGE");
  let body: Record<string, unknown> = {};
  try {
    body = (JSON.parse(text) ?? {}) as Record<string, unknown>;
  } catch {
    throw new HttpError("Request body must be valid JSON", 400);
  }
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    kind: KINDS.has(str(body.kind)) ? str(body.kind) : "error",
    message: str(body.message) || "(no message)",
    // The path only: a query string can carry anything.
    route: str(body.route).split(/[?#]/)[0],
    stack: str(body.stack),
  };
}

/** Logs one crash report unless the person is over the limit. Never fails the request. */
export async function logClientError(
  env: Env,
  user: Pick<AuthorizedUser, "personId">,
  report: { kind: string; message: string; route: string; stack: string },
): Promise<{ logged: boolean }> {
  if (!configured(env) || !allowClientError(user.personId)) return { logged: false };
  try {
    const logged = await db(env).rpc<boolean>("log_client_error", {
      p_person: user.personId,
      p_route: report.route.slice(0, 200),
      p_message: scrub(report.message, 500),
      p_detail: { kind: report.kind, ...(report.stack ? { stack: scrub(report.stack, 1000) } : {}) },
      p_limit: CLIENT_ERRORS_PER_HOUR,
    });
    return { logged: logged === true };
  } catch (err) {
    console.error("Client error not logged:", err instanceof Error ? err.message : err);
    return { logged: false };
  }
}

// ── Reading ───────────────────────────────────────────────────────────────

async function snapshot(env: Env): Promise<HealthSnapshot> {
  return db(env).rpc<HealthSnapshot>("system_health_snapshot", {});
}

export interface SystemView {
  ok: boolean;
  checks: HealthCheck[];
  jobs: JobRow[];
  errors: { at: string; source: string; route: string | null; status: number | null; message: string | null; request_id: string | null }[];
  serverErrors24h: number;
  clientErrors24h: number;
}

/** GET /api/system: the owner and the Section Captains. */
export async function getSystemView(env: Env, user: AuthorizedUser): Promise<SystemView> {
  if (!canViewSystem(env, user)) throw new HttpError("Officer access required.", 403, "OFFICER_ACCESS_REQUIRED");
  const d = db(env);
  const [snap, errors] = await Promise.all([
    snapshot(env),
    d.select<SystemView["errors"][number]>("error_log", "select=id,at,source,route,status,message,request_id&order=at.desc&limit=50"),
  ]);
  const { ok, checks } = evaluateHealth(snap, { now: new Date() });
  return {
    ok,
    checks,
    jobs: snap.jobs,
    errors: errors.map(({ at, source, route, status, message, request_id }) => ({ at, source, route, status, message, request_id })),
    serverErrors24h: snap.server_errors_24h,
    clientErrors24h: snap.client_errors_24h,
  };
}

/** My Tasks: true when the owner should look at /system. Five minutes in this isolate. */
export async function systemNeedsLook(env: Env, user: AuthorizedUser): Promise<boolean> {
  if (!configured(env) || !isSystemOwner(env, user)) return false;
  try {
    const { data } = await getCached("system-health:ok", async () => evaluateHealth(await snapshot(env), { now: new Date() }).ok, 5 * 60 * 1000);
    return !data;
  } catch (err) {
    // Can't read the tables (e.g. before the migration): no line, the page still says why.
    console.error("System health not read:", err instanceof Error ? err.message : err);
    return false;
  }
}

// ── The daily check ───────────────────────────────────────────────────────

/** HEALTH_CRON: prune, check, alert, heartbeat. About ten outside calls. */
export async function runHealthCron(env: Env, now = new Date()): Promise<{ ok: boolean; checks: HealthCheck[]; emailed: boolean }> {
  if (!configured(env)) return { ok: true, checks: [], emailed: false };
  const d = db(env);
  try {
    await d.rpc<number>("prune_system_health", {}).catch((err) => console.error("prune_system_health failed:", err instanceof Error ? err.message : err));
    const snap = await snapshot(env);
    const { ok, checks } = evaluateHealth(snap, { now, skip: [HEALTH_JOB] });
    const failed = checks.filter((c) => !c.ok);
    const emailed = failed.length > 0 ? await alertOwner(env, snap, failed, now) : false;
    console.log("health check " + JSON.stringify({ ok, failed: failed.map((c) => c.key), emailed }));
    await recordHeartbeat(env, HEALTH_JOB, true, { healthy: ok, failed: failed.map((c) => c.key), emailed });
    return { ok, checks, emailed };
  } catch (err) {
    await recordHeartbeat(env, HEALTH_JOB, false, { error: scrub(errorText(err), 300) });
    throw err;
  }
}

/** Whether the alert should go: not already today, and not into the day's last few emails. Pure. */
export function shouldAlert(snap: HealthSnapshot, sentToday: number, now: Date): boolean {
  const last = snap.jobs.find((j) => j.job === ALERT_JOB);
  if (last && hoursAgo(last.ran_at, now) < 20) return false;
  return sentToday + 1 <= DAILY_LIMIT - EMAIL_RESERVE;
}

async function alertOwner(env: Env, snap: HealthSnapshot, failed: HealthCheck[], now: Date): Promise<boolean> {
  const to = ownerEmails(env)[0];
  if (!to) return false;
  try {
    const d = db(env);
    const sentToday = await d.rpc<number>("emails_sent_today", {});
    if (!shouldAlert(snap, sentToday, now)) return false;
    const [owner] = await d.select<{ id: string }>("people", `select=id&email=${eq(to)}&limit=1`);
    const app = (env.APP_ORIGIN ?? "https://app.eddy.global").replace(/\/+$/, "");
    await sendEmail(env, {
      // email_log.to_person_id is nullable: the owner's mailbox need not be on a People record.
      toPersonId: (owner?.id ?? null) as unknown as string,
      to,
      subject: "Eddy: system check failed",
      text: [...failed.map((c) => `- ${c.label}${c.note ? `: ${c.note}` : ""}`), "", `${app}/system`].join("\n"),
      template: "system-health",
    });
    await recordHeartbeat(env, ALERT_JOB, true, { failed: failed.map((c) => c.key) });
    return true;
  } catch (err) {
    console.error("System alert not sent:", err instanceof Error ? err.message : err);
    return false;
  }
}
