/**
 * Web Push: personal alerts only (6 Oct 2026 review, item D7; owner
 * approved). Eddy never pushes a half-built squad on its own.
 *
 *  - a selected player says No → that team's coaches (availability.ts);
 *  - the Umpire Coordinator takes someone off a duty → that umpire (umpiring.ts;
 *    HKHA's own moves reach the umpire through My Tasks, not push);
 *  - a holder passes kit on → the receiver, who must confirm it (kit.ts);
 *  - "Send to Eddy app" in Notify → the squad (POST /api/push/squad).
 *
 * Off unless PUSH = "on" and the VAPID_PRIVATE_KEY secret is set: then the
 * config route says disabled, the app hides the switch, and nothing is
 * sent. Devices live in push_subscriptions (migration 20261007180005),
 * read fresh for each send and deleted when the push service answers 404
 * or 410.
 *
 * Budget (free plan: 50 subrequests per request or cron run): one read of
 * the devices, one POST per device, and one delete when any device has
 * gone. At most MAX_SENDS_PER_INVOCATION device sends per request, shared
 * by every send in it, and never more than the request's database calls
 * leave room for. Alerts are sent after the response (waitUntil): a push
 * failure never fails the change that caused it.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { HttpError } from "./http";
import { db, eq, inList } from "./data/supabase";
import { currentRequestContext, inBackground, type RequestContext } from "./requestContext";
import { importVapidKey, pushRequest, type VapidKey } from "./webPush";

/** Device sends per request or cron run, whatever else it does. */
export const MAX_SENDS_PER_INVOCATION = 40;
/** The free plan's subrequests per invocation, and what is kept back for the rest of the request. */
const SUBREQUEST_LIMIT = 50;
const SUBREQUEST_HEADROOM = 4;
/** How long a push service keeps trying a device that is off (seconds). */
const TTL_SECONDS = 12 * 3600;
const SEND_TIMEOUT_MS = 8000;
/** The reply-to address of Eddy's mail, for push services to contact. */
const DEFAULT_SUBJECT = "mailto:menscaptain@hkfchockey.com";

export interface PushMessage {
  title: string;
  body: string;
  /** Where a tap opens, an app path ("/coach/match/rec…"). */
  url: string;
  /** Same tag: a newer notification replaces the older one on the device. */
  tag: string;
}

/** Who to send to: People uuids (people.id) or api ids. */
export type Recipients = { uuids: string[] } | { apiIds: string[] };

export interface SendResult {
  /** People with at least one device. */
  people: number;
  /** Devices sent to. */
  devices: number;
  /** People with at least one device the push service accepted. */
  reached: number;
  /** Devices removed (404/410). */
  pruned: number;
  /** Devices left out by the budget. */
  skipped: number;
}

const NOTHING: SendResult = { people: 0, devices: 0, reached: 0, pruned: 0, skipped: 0 };

export function pushEnabled(env: Env): boolean {
  return env.PUSH === "on" && !!env.VAPID_PRIVATE_KEY;
}

// The imported key, per isolate, for the secret it was made from.
let keyCache: { secret: string; key: Promise<VapidKey> } | null = null;
function vapidKey(env: Env): Promise<VapidKey> {
  const secret = env.VAPID_PRIVATE_KEY ?? "";
  if (keyCache?.secret === secret) return keyCache.key;
  const key = importVapidKey(secret);
  key.catch(() => undefined);
  keyCache = { secret, key };
  return key;
}

/** GET /api/push/config: whether push is on, and the key the app subscribes with. */
export async function pushConfig(env: Env): Promise<{ enabled: boolean; publicKey: string | null }> {
  if (!pushEnabled(env)) return { enabled: false, publicKey: null };
  try {
    return { enabled: true, publicKey: (await vapidKey(env)).publicKey };
  } catch (err) {
    console.error("VAPID key unusable:", err instanceof Error ? err.message : err);
    return { enabled: false, publicKey: null };
  }
}

// ── The budget ───────────────────────────────────────────────────────────

export interface PushBudget {
  left: number;
}

const budgets = new WeakMap<RequestContext, PushBudget>();

/** This request's shared budget; a fresh one outside a request (tests, a cron passes its own). */
export function invocationBudget(): PushBudget {
  const context = currentRequestContext();
  if (!context) return { left: MAX_SENDS_PER_INVOCATION };
  let budget = budgets.get(context);
  if (!budget) budgets.set(context, (budget = { left: MAX_SENDS_PER_INVOCATION }));
  return budget;
}

/** Device sends the request can still afford: the budget, and the subrequests its database calls leave. */
function affordable(budget: PushBudget): number {
  const used = currentRequestContext()?.stats.dbCalls ?? 0;
  // One more call is kept for deleting gone devices.
  return Math.max(0, Math.min(budget.left, SUBREQUEST_LIMIT - SUBREQUEST_HEADROOM - used - 1));
}

// ── Sending ──────────────────────────────────────────────────────────────

interface DeviceRow {
  id: string;
  person_id: string;
  endpoint: string;
  p256dh: string | null;
  auth: string | null;
}

/** One device per person first, then the rest: a capped send reaches as many people as it can. */
function fairOrder(rows: DeviceRow[]): DeviceRow[] {
  const byPerson = new Map<string, DeviceRow[]>();
  for (const r of rows) byPerson.set(r.person_id, [...(byPerson.get(r.person_id) ?? []), r]);
  const out: DeviceRow[] = [];
  for (let round = 0; out.length < rows.length; round++) {
    for (const list of byPerson.values()) if (list[round]) out.push(list[round]);
  }
  return out;
}

const valid = (ids: readonly string[]) => [...new Set(ids.filter((id) => typeof id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(id)))];

/**
 * Sends one message to these people's devices, within the budget. Never
 * throws for a device; a failed read of the devices does throw.
 */
export async function send(env: Env, recipients: Recipients, message: PushMessage, budget = invocationBudget()): Promise<SendResult> {
  if (!pushEnabled(env)) return NOTHING;
  const byUuid = "uuids" in recipients;
  const ids = valid(byUuid ? recipients.uuids : recipients.apiIds);
  if (ids.length === 0) return NOTHING;

  const query = byUuid
    ? `select=id,person_id,endpoint,p256dh,auth&person_id=${inList(ids)}`
    : `select=id,person_id,endpoint,p256dh,auth,people!inner(api_id)&people.api_id=${inList(ids)}`;
  const rows = (await db(env).select<DeviceRow>("push_subscriptions", query)).filter((r) => r.p256dh && r.auth);
  if (rows.length === 0) return NOTHING;

  const people = new Set(rows.map((r) => r.person_id)).size;
  const ordered = fairOrder(rows);
  const devices = ordered.slice(0, affordable(budget));
  budget.left -= devices.length;
  const skipped = ordered.length - devices.length;
  if (skipped > 0) console.warn(`Push: ${skipped} device(s) left out by the budget`);
  if (devices.length === 0) return { ...NOTHING, people, skipped };

  const key = await vapidKey(env);
  const subject = env.VAPID_SUBJECT || DEFAULT_SUBJECT;
  const payload = JSON.stringify(message);
  const gone: string[] = [];
  const reached = new Set<string>();
  await Promise.all(
    devices.map(async (d) => {
      try {
        const { url, init } = await pushRequest(key, subject, { endpoint: d.endpoint, p256dh: d.p256dh!, auth: d.auth! }, payload, {
          ttlSeconds: TTL_SECONDS,
          urgency: "normal",
          topic: message.tag,
        });
        const res = await fetch(url, { ...init, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
        if (res.status === 404 || res.status === 410) gone.push(d.id);
        else if (res.ok) reached.add(d.person_id);
        else console.warn(`Push: ${new URL(d.endpoint).host} answered ${res.status}`);
      } catch (err) {
        console.warn("Push: send failed:", err instanceof Error ? err.message : err);
      }
    }),
  );
  if (gone.length > 0) {
    try {
      await db(env).remove("push_subscriptions", `id=${inList(gone)}`);
    } catch (err) {
      console.warn("Push: gone devices not removed:", err instanceof Error ? err.message : err);
    }
  }
  return { people, devices: devices.length, reached: reached.size, pruned: gone.length, skipped };
}

/**
 * An alert after the response, skipping whoever made the change. Never
 * throws and never delays the request: the write it follows has happened.
 * The promise settles at once inside a request (waitUntil carries the
 * work); outside one (tests) it settles when the work is done.
 */
export function notifyLater(env: Env, recipients: Recipients, message: PushMessage): Promise<void> {
  if (!pushEnabled(env)) return Promise.resolve();
  const context = currentRequestContext();
  const notMe = (to: Recipients): Recipients =>
    "uuids" in to
      ? { uuids: to.uuids.filter((id) => id !== context?.personUuid) }
      : { apiIds: to.apiIds.filter((id) => id !== context?.personId) };
  return inBackground(() => send(env, notMe(recipients), message));
}

// ── Wording ──────────────────────────────────────────────────────────────

const HK_DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Hong_Kong", weekday: "short", day: "numeric", month: "short" });
const HK_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Hong_Kong", hour: "2-digit", minute: "2-digit", hour12: false });

/** "Sat 14 Oct 09:00", or "Sat 14 Oct" while the time is TBC. */
export function when(iso: string | null | undefined): string {
  if (!iso) return "date TBC";
  const d = new Date(iso);
  const time = HK_TIME.format(d);
  // A time not yet set is stored as midnight, as in matches and duties.
  return time === "00:00" ? HK_DAY.format(d) : `${HK_DAY.format(d)} ${time}`;
}

const nameOf = (p: { preferred_name?: string | null; given_names?: string | null; surname?: string | null } | null | undefined) =>
  [p?.preferred_name || p?.given_names, p?.surname].filter(Boolean).join(" ").trim() || "A player";

// ── Alert: a selected player says No ─────────────────────────────────────

interface SelectionRow {
  side: "home" | "away";
  matches: { api_id: string; home_team: string | null; away_team: string | null; match_date: string | null };
  people: { id: string; api_id: string; preferred_name: string | null; given_names: string | null; surname: string | null };
}

/**
 * A player's answer changed to No for these matches: the coaches of each
 * team they're selected for get one alert per fixture. Only called when the
 * stored answer wasn't already No (availability.ts).
 */
export function alertPlayerOut(env: Env, playerApiId: string, matchApiIds: string[]): Promise<void> {
  if (!pushEnabled(env) || matchApiIds.length === 0) return Promise.resolve();
  const context = currentRequestContext();
  return inBackground(async () => {
    const d = db(env);
    const selected = await d.select<SelectionRow>(
      "match_selections",
      `select=side,matches!inner(api_id,home_team,away_team,match_date),people!inner(id,api_id,preferred_name,given_names,surname)` +
        `&people.api_id=${eq(playerApiId)}&matches.api_id=${inList(valid(matchApiIds))}`,
      "match_id,side",
    );
    if (selected.length === 0) return;
    const teamOf = (s: SelectionRow) => (s.side === "home" ? s.matches.home_team : s.matches.away_team) ?? "";
    const teams = [...new Set(selected.map(teamOf).filter(Boolean))];
    if (teams.length === 0) return;
    const coaches = await d.select<{ person_id: string; teams: { team_name: string } }>(
      "team_people",
      `select=person_id,teams!inner(team_name)&role=eq.coach&teams.team_name=${inList(teams)}`,
      "team_id,role,person_id",
    );
    const budget = invocationBudget();
    for (const s of selected) {
      const player = s.people;
      // Not the player themself (a coach who plays), nor whoever made the change.
      const to = coaches
        .filter((c) => c.teams.team_name === teamOf(s) && c.person_id !== player.id && c.person_id !== context?.personUuid)
        .map((c) => c.person_id);
      if (to.length === 0) continue;
      await send(
        env,
        { uuids: to },
        {
          title: `${nameOf(player)} is out`,
          body: `${s.matches.home_team} vs ${s.matches.away_team} · ${when(s.matches.match_date)}`,
          url: `/coach/match/${s.matches.api_id}`,
          tag: `out-${s.matches.api_id}-${player.api_id}`,
        },
        budget,
      );
    }
  });
}

/**
 * The hook in availability.ts: after an answer is saved, alerts the coaches
 * for the fixtures it turned to No (the stored answer before wasn't No).
 */
export function alertIfNowOut(
  env: Env,
  playerApiId: string,
  status: string,
  matchApiIds: string[],
  before: readonly { matchId: string; status: string }[],
): Promise<void> {
  if (status !== "Unavailable") return Promise.resolve();
  const wasOut = new Set(before.filter((b) => b.status === "Unavailable").map((b) => b.matchId));
  return alertPlayerOut(env, playerApiId, matchApiIds.filter((id) => !wasOut.has(id)));
}

// ── Alert: taken off a duty ──────────────────────────────────────────────

/**
 * The Umpire Coordinator took this person (a People uuid) off a duty they
 * held or offered for (umpiring.ts). The duty is read after the response.
 */
export function alertDutyRemoved(env: Env, personUuid: string | null, dutyId: string): Promise<void> {
  if (!pushEnabled(env) || !personUuid) return Promise.resolve();
  const context = currentRequestContext();
  if (personUuid === context?.personUuid) return Promise.resolve();
  return inBackground(async () => {
    const duty = await db(env).one<{ id: string; match_date: string; time_tbc: boolean | null; home_team: string; away_team: string }>(
      "umpire_duties",
      `select=id,match_date,time_tbc,home_team,away_team&id=${eq(dutyId)}`,
    );
    if (!duty) return;
    const at = duty.time_tbc ? HK_DAY.format(new Date(duty.match_date)) : when(duty.match_date);
    await send(env, { uuids: [personUuid] }, {
      title: "Taken off an umpiring duty",
      body: `${duty.home_team} vs ${duty.away_team} · ${at}`,
      url: "/umpiring",
      tag: `duty-${duty.id}`,
    });
  });
}

// ── Alert: kit offered ───────────────────────────────────────────────────

/** A holder passed kit on: the receiver (an api id) confirms it on Player view (kit.ts). */
export function alertKitOffered(env: Env, user: Pick<AuthorizedUser, "personId" | "person">, toApiId: string | null, sets: number): Promise<void> {
  if (!toApiId || sets === 0 || toApiId === user.personId) return Promise.resolve();
  const from = [user.person.preferredName || user.person.givenNames, user.person.surname].filter(Boolean).join(" ") || "Someone";
  return notifyLater(env, { apiIds: [toApiId] }, {
    title: "Kit for you",
    body: `${from} has passed you ${sets === 1 ? "a kit set" : `${sets} kit sets`}. Confirm you've got it.`,
    url: "/",
    tag: `kit-${toApiId}`,
  });
}

// ── Routes ───────────────────────────────────────────────────────────────

const SIDES = new Set(["home", "away"]);
const MAX_ENDPOINT = 1000;
const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

function endpointOf(v: unknown): string {
  if (typeof v !== "string" || v.length > MAX_ENDPOINT) throw new HttpError("Bad push subscription.", 400, "INVALID_INPUT");
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    throw new HttpError("Bad push subscription.", 400, "INVALID_INPUT");
  }
  if (url.protocol !== "https:") throw new HttpError("Bad push subscription.", 400, "INVALID_INPUT");
  return v;
}

/** POST /api/push/subscribe {endpoint, keys: {p256dh, auth}}: this device, for the signed-in person (one device, one person). */
async function subscribe(env: Env, user: AuthorizedUser, body: Record<string, unknown>, userAgent: string | null) {
  if (!pushEnabled(env)) throw new HttpError("Notifications are off.", 409, "PUSH_DISABLED");
  const endpoint = endpointOf(body.endpoint);
  const keys = (body.keys ?? {}) as Record<string, unknown>;
  const p256dh = typeof keys.p256dh === "string" && keys.p256dh.length <= 200 && B64URL.test(keys.p256dh) ? keys.p256dh : "";
  const auth = typeof keys.auth === "string" && keys.auth.length <= 50 && B64URL.test(keys.auth) ? keys.auth : "";
  if (!p256dh || !auth) throw new HttpError("Bad push subscription.", 400, "INVALID_INPUT");
  await db(env).upsert(
    "push_subscriptions",
    [{ person_id: user.personUuid, endpoint, p256dh, auth, user_agent: userAgent?.slice(0, 300) ?? null }],
    "endpoint",
  );
  return { ok: true };
}

/** POST /api/push/unsubscribe {endpoint}: this device stops (only the signed-in person's own). */
async function unsubscribe(env: Env, user: AuthorizedUser, body: Record<string, unknown>) {
  const endpoint = endpointOf(body.endpoint);
  await db(env).remove("push_subscriptions", `endpoint=${eq(endpoint)}&person_id=${eq(user.personUuid)}`);
  return { ok: true };
}

/**
 * POST /api/push/squad {matchId, side}: "Send to Eddy app" in Notify. Only
 * that side's coaches (Section Captains and the Assistant Director coach
 * every team). Sent now, so the coach sees how many it reached.
 */
async function sendSquad(env: Env, user: AuthorizedUser, body: Record<string, unknown>) {
  if (user.role !== "coach") throw new HttpError("Coach access required.", 403, "COACH_ACCESS_REQUIRED");
  const matchId = typeof body.matchId === "string" ? body.matchId : "";
  const side = typeof body.side === "string" ? body.side : "";
  if (!/^[A-Za-z0-9-]{3,64}$/.test(matchId) || !SIDES.has(side)) throw new HttpError("Choose the fixture and side.", 400, "INVALID_INPUT");
  if (!pushEnabled(env)) throw new HttpError("Notifications are off.", 409, "PUSH_DISABLED");
  const d = db(env);
  const match = await d.one<{ id: string; api_id: string; home_team: string | null; away_team: string | null; match_date: string | null }>(
    "matches",
    `select=id,api_id,home_team,away_team,match_date&api_id=${eq(matchId)}`,
  );
  if (!match) throw new HttpError("Fixture not found.", 404, "NOT_FOUND");
  const team = side === "home" ? match.home_team : match.away_team;
  if (!team || !user.coachTeams.includes(team)) throw new HttpError("Only this team's coaches can send its squad.", 403, "COACH_ACCESS_REQUIRED");
  const squad = await d.select<{ person_id: string }>(
    "match_selections",
    `select=person_id&match_id=${eq(match.id)}&side=${eq(side)}`,
    "person_id",
  );
  const players = squad.map((s) => s.person_id).filter((id) => id !== user.personUuid);
  if (players.length === 0) return { players: 0, reached: 0, devices: 0 };
  const result = await send(env, { uuids: players }, {
    title: "You're selected",
    body: `${match.home_team} vs ${match.away_team} · ${when(match.match_date)}`,
    url: "/",
    tag: `squad-${match.api_id}-${side}`,
  });
  return { players: players.length, reached: result.reached, devices: result.devices };
}

/** Whether a path is one of these routes. */
export const isPushPath = (pathname: string) => pathname.startsWith("/api/push/");

/** The /api/push/* routes, once the caller is signed in. Undefined: no such route. */
export async function pushRoute(env: Env, user: AuthorizedUser, method: string, pathname: string, body: () => Promise<unknown>, userAgent: string | null) {
  const input = async () => ((await body()) ?? {}) as Record<string, unknown>;
  if (method === "GET" && pathname === "/api/push/config") return pushConfig(env);
  if (method === "POST" && pathname === "/api/push/subscribe") return subscribe(env, user, await input(), userAgent);
  if (method === "POST" && pathname === "/api/push/unsubscribe") return unsubscribe(env, user, await input());
  if (method === "POST" && pathname === "/api/push/squad") return sendSquad(env, user, await input());
  return undefined;
}
