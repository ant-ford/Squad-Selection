import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../worker/src/env";
import { setAvailability, setPlayerAvailability } from "../worker/src/availability";
import { moveKit } from "../worker/src/kit";
import { withdrawAssignment } from "../worker/src/umpiring";
import { invalidateAll } from "../worker/src/cache";
import { newRequestStats, runWithRequestContext } from "../worker/src/requestContext";
import { useFakeRepos } from "./helpers/fakeRepos";
import { fakePostgrest, SUPABASE_TEST_ENV, type FakePostgrest, type PgRow } from "./helpers/postgrest";
import { exception, match, person, recId, signedIn } from "./helpers/factories";

// The three alert hooks (availability.ts, umpiring.ts, kit.ts) as their
// callers run them: inside a request, the push going out after the response.

const P256DH = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const AUTH = "BTBZMqHH6r4Tts7J_aSIgg";

let VAPID = "";
beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])) as CryptoKeyPair;
  VAPID = JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey));
});
const env = (push = true) => ({ ...SUPABASE_TEST_ENV, PUSH: push ? "on" : undefined, VAPID_PRIVATE_KEY: VAPID }) as unknown as Env;

const device = (n: number, personUuid: string, apiId = ""): PgRow => ({
  id: `d${n}`,
  person_id: personUuid,
  endpoint: `https://push.example/${n}`,
  p256dh: P256DH,
  auth: AUTH,
  people: { api_id: apiId },
});

let pg: FakePostgrest;
let pushed: { url: string; body: unknown }[];

function install(tables: Record<string, PgRow[]>) {
  pg = fakePostgrest({
    tables: { push_subscriptions: [], ...tables },
    other: (url, init) => {
      pushed.push({ url, body: init.body });
      return new Response(null, { status: 201 });
    },
  });
}

/** Runs `work` as a request does, then waits for what it left to waitUntil. */
async function inRequest<T>(work: () => Promise<T>, personUuid?: string): Promise<T> {
  const later: Promise<unknown>[] = [];
  const result = await runWithRequestContext({ stats: newRequestStats(), waitUntil: (p) => later.push(p), personUuid }, work);
  await Promise.all(later);
  return result;
}

beforeEach(() => {
  pushed = [];
  invalidateAll();
});

// ── A selected player says No ──────────────────────────────────────────

describe("availability: a selected player turning No alerts the coach", () => {
  const SAM = recId("Sam");
  const COACH = recId("Coach");
  const M1 = recId("Match1");
  const M2 = recId("Match2");
  const SAM_UUID = "00000000-0000-4000-8000-00000000a001";
  const COACH_UUID = "00000000-0000-4000-8000-00000000c001";

  const db = useFakeRepos(() => ({
    people: [person({ id: SAM, preferredName: "Sam", surname: "Lee" }), person({ id: COACH })],
    matches: [
      match({ id: M1, homeTeam: "HKFC C", awayTeam: "Pak A", matchDate: "2026-10-17T01:30:00Z", season: "2026-2027" }),
      match({ id: M2, homeTeam: "HKFC C", awayTeam: "Valley B", matchDate: "2026-10-24T01:30:00Z", season: "2026-2027" }),
    ],
  }));

  /** Sam is selected for M1 only. */
  function selection() {
    install({
      push_subscriptions: [device(1, COACH_UUID), device(2, SAM_UUID)],
      match_selections: [
        {
          match_id: "m1",
          side: "home",
          person_id: SAM_UUID,
          matches: { api_id: M1, home_team: "HKFC C", away_team: "Pak A", match_date: "2026-10-17T01:30:00Z" },
          people: { id: SAM_UUID, api_id: SAM, preferred_name: "Sam", given_names: null, surname: "Lee" },
        },
      ],
      team_people: [{ team_id: "t1", role: "coach", person_id: COACH_UUID, teams: { team_name: "HKFC C" } }],
    });
  }

  const payloadCount = () => pushed.length;

  it("pushes to the coach when a selected player answers No", async () => {
    selection();
    await inRequest(() => setAvailability(env(), { playerId: SAM, matchIds: [M1], status: "Unavailable" }));
    expect(pushed.map((p) => p.url)).toEqual(["https://push.example/1"]);
    const read = pg.reads("match_selections")[0];
    expect(read.params.get("people.api_id")).toBe(`eq.${SAM}`);
  });

  it("stays quiet when the player isn't selected for that fixture", async () => {
    selection();
    await inRequest(() => setAvailability(env(), { playerId: SAM, matchIds: [M2], status: "Unavailable" }));
    expect(payloadCount()).toBe(0);
    expect(pg.reads("team_people")).toHaveLength(0);
  });

  it("stays quiet when the answer was already No", async () => {
    selection();
    db.state.availabilityExceptions.push(exception({ player: [SAM], match: [M1], availabilityStatus: "Unavailable", season: "2026-2027" }));
    await inRequest(() => setAvailability(env(), { playerId: SAM, matchIds: [M1], status: "Unavailable" }));
    expect(pg.calls).toHaveLength(0);
  });

  it("stays quiet for Maybe and Available", async () => {
    selection();
    await inRequest(() => setAvailability(env(), { playerId: SAM, matchIds: [M1], status: "Maybe" }));
    await inRequest(() => setAvailability(env(), { playerId: SAM, matchIds: [M1], status: "Available" }));
    expect(pg.calls).toHaveLength(0);
  });

  it("doesn't push to the coach who answered for the player", async () => {
    selection();
    await inRequest(() => setPlayerAvailability(env(), { coachPersonId: COACH, playerId: SAM, matchId: M1, status: "Unavailable" }), COACH_UUID);
    expect(payloadCount()).toBe(0);
  });

  it("reads and sends nothing while push is off", async () => {
    selection();
    await inRequest(() => setAvailability(env(false), { playerId: SAM, matchIds: [M1], status: "Unavailable" }));
    expect(pg.calls).toHaveLength(0);
  });

  it("never fails the answer when the push read fails", async () => {
    install({ push_subscriptions: [] }); // no match_selections table: the read is refused
    const r = await inRequest(() => setAvailability(env(), { playerId: SAM, matchIds: [M1], status: "Unavailable" }));
    expect(r.success).toBe(true);
    expect(db.state.availabilityExceptions).toHaveLength(1);
    pg.problems.length = 0; // the refused read was the point
  });
});

// ── Taken off a duty ───────────────────────────────────────────────────

describe("umpiring: the coordinator taking someone off a duty alerts them", () => {
  const ASSIGNMENT = "a0000000-0000-4000-8000-000000000001";
  const DUTY = "d0000000-0000-4000-8000-000000000001";
  const george = signedIn({ email: "g@x.com", personId: "recGEORGE", personUuid: "uG", officerRoles: [{ office: "umpireCoordinator", designation: "" }] });
  const ann = signedIn({ email: "a@x.com", personId: "recANN", personUuid: "uA", umpire: true });

  function tables() {
    install({
      people: [
        { id: "uG", api_id: "recGEORGE", preferred_name: "George", given_names: null, surname: "C" },
        { id: "uA", api_id: "recANN", preferred_name: "Ann", given_names: null, surname: "U" },
      ],
      umpire_assignments: [{ id: ASSIGNMENT, duty_id: DUTY, person_id: "uA", external_name: null, paid: false, status: "confirmed", created_at: "2026-10-01T00:00:00Z" }],
      umpire_duties: [{ id: DUTY, match_date: "2026-10-17T01:30:00Z", time_tbc: false, home_team: "Pak A", away_team: "Valley B" }],
      push_subscriptions: [device(1, "uA"), device(2, "uG")],
    });
  }

  it("pushes to the umpire the coordinator took off", async () => {
    tables();
    await inRequest(() => withdrawAssignment(env(), george, ASSIGNMENT), "uG");
    expect(pushed.map((p) => p.url)).toEqual(["https://push.example/1"]);
  });

  it("doesn't push to an umpire who pulled out themself", async () => {
    tables();
    await inRequest(() => withdrawAssignment(env(), ann, ASSIGNMENT), "uA");
    expect(pushed).toHaveLength(0);
    expect(pg.reads("umpire_duties")).toHaveLength(0);
  });
});

// ── Kit offered ────────────────────────────────────────────────────────

describe("kit: passing a set on alerts the receiver", () => {
  const SET = "5e700000-0000-4000-8000-000000000001";
  const tom = signedIn({ email: "t@x.com", personId: "recTOM", personUuid: "uT", person: { id: "recTOM", uuid: "uT", givenNames: "Tom", surname: "Wu" } as never });

  function tables(result: { moved: string[]; offered: string[] }) {
    pg = fakePostgrest({
      tables: { push_subscriptions: [device(1, "uA", "recANN"), device(2, "uT", "recTOM")], people: [{ id: "uA", api_id: "recANN" }, { id: "uT", api_id: "recTOM" }] },
      relations: { "push_subscriptions.people": { table: "people", from: "person_id", to: "id", kind: "one" } },
      rpc: { kit_move: () => ({ ...result, conflicts: [] }) },
      other: (url, init) => {
        pushed.push({ url, body: init.body });
        return new Response(null, { status: 201 });
      },
    });
  }

  it("pushes to the receiver of an offered set", async () => {
    tables({ moved: [], offered: [SET] });
    const r = await inRequest(() => moveKit(env(), tom, { setIds: [SET], to: "recANN" }), "uT");
    expect(r.offered).toEqual([SET]);
    expect(pushed.map((p) => p.url)).toEqual(["https://push.example/1"]);
  });

  it("stays quiet when the kit moved at once (an officer's move) or went back to the store", async () => {
    tables({ moved: [SET], offered: [] });
    await inRequest(() => moveKit(env(), tom, { setIds: [SET], to: "recANN" }), "uT");
    await inRequest(() => moveKit(env(), tom, { setIds: [SET], to: null }), "uT");
    expect(pushed).toHaveLength(0);
    expect(pg.reads("push_subscriptions")).toHaveLength(0);
  });
});
