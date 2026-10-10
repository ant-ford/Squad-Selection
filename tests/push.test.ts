import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fakePostgrest, SUPABASE_TEST_ENV, type FakePostgrest, type PgRow } from "./helpers/postgrest";
import { alertDutyRemoved, alertKitOffered, alertPlayerOut, MAX_SENDS_PER_INVOCATION, pushConfig, pushSquad, pushSubscribe, pushUnsubscribe, send, when, type PushMessage } from "../worker/src/push";
import { importVapidKey } from "../worker/src/webPush";
import { newRequestStats, runWithRequestContext, type RequestContext } from "../worker/src/requestContext";
import type { AuthorizedUser } from "../worker/src/auth";
import type { Env } from "../worker/src/env";

// A device's keys (RFC 8291 Appendix A's user agent): any valid P-256 key will do.
const P256DH = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const AUTH = "BTBZMqHH6r4Tts7J_aSIgg";

let VAPID = "";
beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  VAPID = JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey));
});

const env = (over: Partial<Env> = {}) => ({ ...SUPABASE_TEST_ENV, PUSH: "on", VAPID_PRIVATE_KEY: VAPID, ...over }) as unknown as Env;

const MSG: PushMessage = { title: "T", body: "B", url: "/", tag: "t" };

const device = (n: number, person: string, extra: PgRow = {}): PgRow => ({
  id: `d${n}`,
  person_id: person,
  endpoint: `https://push.example/${n}`,
  p256dh: P256DH,
  auth: AUTH,
  people: { api_id: `rec${person}` },
  ...extra,
});

let pg: FakePostgrest;
/** Pushes the fake push service received, by endpoint. */
let sent: { url: string; headers: Record<string, string> }[];
/** What the push service answers each endpoint (default 201). */
let answer: Record<string, number>;

function install(tables: Record<string, PgRow[]>, relations = {}) {
  pg = fakePostgrest({
    tables: { push_subscriptions: [], ...tables },
    relations,
    other: (url, init) => {
      sent.push({ url, headers: init.headers as Record<string, string> });
      return new Response(null, { status: answer[url] ?? 201 });
    },
  });
}

beforeEach(() => {
  sent = [];
  answer = {};
  install({});
});

describe("push config", () => {
  it("is disabled unless PUSH is on and the key is set", async () => {
    expect(await pushConfig(env({ PUSH: undefined }))).toEqual({ enabled: false, publicKey: null });
    expect(await pushConfig(env({ VAPID_PRIVATE_KEY: undefined }))).toEqual({ enabled: false, publicKey: null });
    expect(await pushConfig(env({ VAPID_PRIVATE_KEY: "{}" }))).toEqual({ enabled: false, publicKey: null });
  });

  it("gives the public key derived from the private JWK", async () => {
    const cfg = await pushConfig(env());
    expect(cfg).toEqual({ enabled: true, publicKey: (await importVapidKey(VAPID)).publicKey });
  });
});

describe("send", () => {
  it("sends nothing and reads nothing while the flag is off", async () => {
    install({ push_subscriptions: [device(1, "u1")] });
    expect(await send(env({ PUSH: "off" }), { uuids: ["u1"] }, MSG)).toMatchObject({ devices: 0 });
    expect(pg.calls).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("sends to each of the people's devices in one read, encrypted, with VAPID", async () => {
    install({ push_subscriptions: [device(1, "u1"), device(2, "u1"), device(3, "u2"), device(4, "u3")] });
    const r = await send(env(), { uuids: ["u1", "u2"] }, MSG);
    expect(r).toEqual({ people: 2, devices: 3, reached: 2, pruned: 0, skipped: 0 });
    expect(pg.reads("push_subscriptions")).toHaveLength(1);
    expect(sent.map((s) => s.url).sort()).toEqual(["https://push.example/1", "https://push.example/2", "https://push.example/3"]);
    expect(sent[0].headers).toMatchObject({ "Content-Encoding": "aes128gcm", TTL: "43200", Urgency: "normal" });
    expect(sent[0].headers.Authorization).toMatch(/^vapid t=.+, k=/);
  });

  it("finds devices by api id through the People row", async () => {
    install({ push_subscriptions: [device(1, "u1"), device(2, "u2")], people: [] }, {
      "push_subscriptions.people": { table: "people", from: "person_id", to: "id", kind: "one" },
    });
    pg.tables.people.push({ id: "u1", api_id: "recu1" }, { id: "u2", api_id: "recu2" });
    const r = await send(env(), { apiIds: ["recu2"] }, MSG);
    expect(r.devices).toBe(1);
    expect(sent.map((s) => s.url)).toEqual(["https://push.example/2"]);
  });

  it("deletes devices the push service says are gone (404/410), in one call", async () => {
    install({ push_subscriptions: [device(1, "u1"), device(2, "u1"), device(3, "u2")] });
    answer["https://push.example/1"] = 410;
    answer["https://push.example/3"] = 404;
    const r = await send(env(), { uuids: ["u1", "u2"] }, MSG);
    expect(r).toMatchObject({ devices: 3, reached: 1, pruned: 2 });
    expect(pg.writes("push_subscriptions")).toHaveLength(1);
    expect(pg.tables.push_subscriptions.map((d) => d.id)).toEqual(["d2"]);
  });

  it("keeps a device the push service refused for another reason", async () => {
    install({ push_subscriptions: [device(1, "u1")] });
    answer["https://push.example/1"] = 500;
    expect(await send(env(), { uuids: ["u1"] }, MSG)).toMatchObject({ devices: 1, reached: 0, pruned: 0 });
    expect(pg.writes("push_subscriptions")).toHaveLength(0);
  });

  it("never sends more than the budget, one device per person first", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => [device(i * 2, `p${i}`), device(i * 2 + 1, `p${i}`)]).flat();
    install({ push_subscriptions: rows });
    const budget = { left: MAX_SENDS_PER_INVOCATION };
    const r = await send(env(), { uuids: rows.map((d) => d.person_id as string) }, MSG, budget);
    expect(r.devices).toBe(MAX_SENDS_PER_INVOCATION);
    expect(r.skipped).toBe(60 - MAX_SENDS_PER_INVOCATION);
    expect(r.reached).toBe(30); // everyone's first device went
    expect(budget.left).toBe(0);
    // A second send in the same invocation has nothing left.
    expect(await send(env(), { uuids: ["p0"] }, MSG, budget)).toMatchObject({ devices: 0, skipped: 2 });
  });

  it("shares one budget across a request, and leaves room for the request's own subrequests", async () => {
    install({ push_subscriptions: Array.from({ length: 45 }, (_, i) => device(i, `p${i}`)) });
    const stats = newRequestStats();
    const context: RequestContext = { stats };
    const ids = Array.from({ length: 45 }, (_, i) => `p${i}`);
    const r = await runWithRequestContext(context, async () => {
      stats.dbCalls = 20; // the request has already made 20 database calls
      return send(env(), { uuids: ids }, MSG);
    });
    // 50 - 4 headroom - 21 database calls (with the device read) - 1 kept for pruning.
    expect(r.devices).toBe(24);
    // The second send gets what's left of the request's 40.
    const again = await runWithRequestContext(context, () => send(env(), { uuids: ids }, MSG));
    expect(again.devices).toBe(MAX_SENDS_PER_INVOCATION - 24);
  });
});

describe("the wording", () => {
  it("writes when in Hong Kong time, and only the day while the time is TBC", () => {
    expect(when("2026-10-17T01:30:00Z")).toBe("Sat 17 Oct 09:30");
    expect(when("2026-10-16T16:00:00Z")).toBe("Sat 17 Oct");
  });
});

// ── Alerts ─────────────────────────────────────────────────────────────

const COACH = "c0000000-0000-4000-8000-000000000001";
const PLAYER = "p0000000-0000-4000-8000-000000000001";
const PLAYING_COACH = "c0000000-0000-4000-8000-000000000002";

function selectionTables(selected: boolean) {
  install(
    {
      push_subscriptions: [device(1, COACH), device(2, PLAYING_COACH), device(3, PLAYER)],
      match_selections: selected
        ? [
            {
              match_id: "m1",
              side: "home",
              person_id: PLAYER,
              matches: { api_id: "recMatch000000001", home_team: "HKFC C", away_team: "Pak A", match_date: "2026-10-17T01:30:00Z" },
              people: { id: PLAYER, api_id: "recSam00000000001", preferred_name: "Sam", given_names: "Samuel", surname: "Lee" },
            },
          ]
        : [],
      team_people: [
        { team_id: "t1", role: "coach", person_id: COACH, teams: { team_name: "HKFC C" } },
        { team_id: "t1", role: "coach", person_id: PLAYER, teams: { team_name: "HKFC C" } },
        { team_id: "t2", role: "coach", person_id: PLAYING_COACH, teams: { team_name: "HKFC D" } },
        { team_id: "t1", role: "team_captain", person_id: PLAYING_COACH, teams: { team_name: "HKFC C" } },
      ],
    },
  );
}

describe("alertPlayerOut", () => {
  it("tells the team's coaches, not the player (even when they coach), with a link to the squad", async () => {
    selectionTables(true);
    await alertPlayerOut(env(), "recSam00000000001", ["recMatch000000001"]);
    expect(sent.map((s) => s.url)).toEqual(["https://push.example/1"]);
    expect(pg.reads("team_people")[0].params.get("role")).toBe("eq.coach");
  });

  it("does nothing when the player isn't selected for the fixture", async () => {
    selectionTables(false);
    await alertPlayerOut(env(), "recSam00000000001", ["recMatch000000001"]);
    expect(sent).toHaveLength(0);
    expect(pg.reads("team_people")).toHaveLength(0);
  });

  it("does nothing at all while push is off", async () => {
    selectionTables(true);
    await alertPlayerOut(env({ PUSH: undefined }), "recSam00000000001", ["recMatch000000001"]);
    expect(pg.calls).toHaveLength(0);
  });
});

describe("alertDutyRemoved and alertKitOffered", () => {
  it("tells the umpire taken off a duty", async () => {
    install({
      push_subscriptions: [device(1, "u1"), device(2, "u2")],
      umpire_duties: [{ id: "duty1", match_date: "2026-10-16T16:00:00Z", time_tbc: true, home_team: "Pak A", away_team: "Valley B" }],
    });
    await alertDutyRemoved(env(), "u1", "duty1");
    expect(sent.map((s) => s.url)).toEqual(["https://push.example/1"]);
    await alertDutyRemoved(env(), null, "duty1");
    await alertDutyRemoved(env(), "u1", "no-such-duty");
    expect(sent).toHaveLength(1);
  });

  it("tells the receiver of offered kit, never the giver", async () => {
    install({ push_subscriptions: [device(1, "u1"), device(2, "u2")] }, {});
    const giver = { personId: "recu2", person: { id: "recu2", givenNames: "Tom", surname: "Wu" } } as unknown as AuthorizedUser;
    await alertKitOffered(env(), giver, "recu2", 1);
    await alertKitOffered(env(), giver, "recu1", 0);
    expect(pg.calls).toHaveLength(0);
    await alertKitOffered(env(), giver, "recu1", 2);
    expect(sent.map((s) => s.url)).toEqual(["https://push.example/1"]);
  });
});

// ── Routes (sign-in itself is covered in authorization-routes) ─────────

const coachUser = (over: Partial<AuthorizedUser> = {}) =>
  ({ personId: "recCoach000000001", personUuid: COACH, role: "coach", coachTeams: ["HKFC C"], ...over }) as AuthorizedUser;

describe("push routes", () => {
  it("subscribes this device for the signed-in person, moving it from anyone else", async () => {
    install({ push_subscriptions: [device(1, "someone-else")] });
    const r = await pushSubscribe(env(), coachUser(), { endpoint: "https://push.example/1", keys: { p256dh: P256DH, auth: AUTH } }, "UA");
    expect(r).toEqual({ ok: true });
    expect(pg.tables.push_subscriptions).toHaveLength(1);
    expect(pg.tables.push_subscriptions[0]).toMatchObject({ person_id: COACH, endpoint: "https://push.example/1", user_agent: "UA" });
  });

  it("refuses a malformed subscription, and subscribing while push is off", async () => {
    await expect(pushSubscribe(env(), coachUser(), { endpoint: "http://x/1", keys: { p256dh: P256DH, auth: AUTH } }, null)).rejects.toMatchObject({ status: 400 });
    await expect(pushSubscribe(env(), coachUser(), { endpoint: "https://x/1", keys: {} }, null)).rejects.toMatchObject({ status: 400 });
    await expect(pushSubscribe(env({ PUSH: undefined }), coachUser(), { endpoint: "https://x/1", keys: { p256dh: P256DH, auth: AUTH } }, null)).rejects.toMatchObject({ status: 409 });
  });

  it("unsubscribes only the person's own device", async () => {
    install({ push_subscriptions: [device(1, COACH), device(2, "other")] });
    await pushUnsubscribe(env(), coachUser(), { endpoint: "https://push.example/2" });
    expect(pg.tables.push_subscriptions).toHaveLength(2);
    await pushUnsubscribe(env(), coachUser(), { endpoint: "https://push.example/1" });
    expect(pg.tables.push_subscriptions.map((d) => d.id)).toEqual(["d2"]);
  });

  function squadTables() {
    install({
      matches: [{ id: "m1", api_id: "recMatch000000001", home_team: "HKFC C", away_team: "Pak A", match_date: "2026-10-17T01:30:00Z" }],
      match_selections: [
        { match_id: "m1", side: "home", person_id: "s1" },
        { match_id: "m1", side: "home", person_id: "s2" },
        { match_id: "m1", side: "home", person_id: COACH },
        { match_id: "m1", side: "away", person_id: "s9" },
      ],
      push_subscriptions: [device(1, "s1"), device(2, "s1"), device(3, "s2"), device(4, "s9"), device(5, COACH)],
    });
  }

  it("sends to every selected player on that side, including the coach who presses Send", async () => {
    squadTables();
    const r = await pushSquad(env(), coachUser(), { matchId: "recMatch000000001", side: "home" });
    expect(r).toEqual({ players: 3, people: 3, reached: 3, devices: 4, pruned: 0, skipped: 0 });
    expect(sent.map((s) => s.url).sort()).toEqual(["https://push.example/1", "https://push.example/2", "https://push.example/3", "https://push.example/5"]);
  });

  it("reaches a selected coach even when they're the only subscribed selected player", async () => {
    squadTables();
    pg.tables.push_subscriptions = [device(5, COACH)];
    expect(await pushSquad(env(), coachUser(), { matchId: "recMatch000000001", side: "home" })).toMatchObject({ players: 3, people: 1, devices: 1, reached: 1 });
    expect(sent.map((s) => s.url)).toEqual(["https://push.example/5"]);
  });

  it("doesn't send a copy to a coach who isn't selected", async () => {
    squadTables();
    pg.tables.match_selections = pg.tables.match_selections.filter((s) => s.person_id !== COACH);
    expect(await pushSquad(env(), coachUser(), { matchId: "recMatch000000001", side: "home" })).toMatchObject({ players: 2, reached: 2 });
    expect(sent.map((s) => s.url)).not.toContain("https://push.example/5");
  });

  it("distinguishes unregistered players from rejected or expired device sends", async () => {
    squadTables();
    pg.tables.push_subscriptions = [];
    expect(await pushSquad(env(), coachUser(), { matchId: "recMatch000000001", side: "home" })).toEqual({ players: 3, people: 0, devices: 0, reached: 0, pruned: 0, skipped: 0 });
    squadTables();
    answer = Object.fromEntries([1, 2, 3, 5].map((n) => [`https://push.example/${n}`, 503]));
    expect(await pushSquad(env(), coachUser(), { matchId: "recMatch000000001", side: "home" })).toMatchObject({ people: 3, devices: 4, reached: 0, pruned: 0 });
    answer = Object.fromEntries([1, 2, 3, 5].map((n) => [`https://push.example/${n}`, 410]));
    expect(await pushSquad(env(), coachUser(), { matchId: "recMatch000000001", side: "home" })).toMatchObject({ people: 3, devices: 4, reached: 0, pruned: 4 });
  });

  it("is only for that team's coaches", async () => {
    squadTables();
    await expect(pushSquad(env(), coachUser(), { matchId: "recMatch000000001", side: "away" })).rejects.toMatchObject({ status: 403 });
    await expect(pushSquad(env(), coachUser({ coachTeams: ["HKFC D"] }), { matchId: "recMatch000000001", side: "home" })).rejects.toMatchObject({ status: 403 });
    await expect(pushSquad(env(), coachUser({ role: "player", coachTeams: [] }), { matchId: "recMatch000000001", side: "home" })).rejects.toMatchObject({ status: 403 });
    expect(sent).toHaveLength(0);
  });
});
