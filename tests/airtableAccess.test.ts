import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Tier-0 Airtable access fixes (docs/ARCHITECTURE_ASSESSMENT_2026-09-19.md):
//   - field projection: People is a 300-field CRM, the app reads 27 of them
//   - previous-season Match Cards narrowed to carded appearances
//   - "Show past" bounded to two seasons instead of every result ever
//   - webhook-backed TTLs, with the in-isolate copy capped regardless
//   - prefix invalidation handed to ctx.waitUntil
//   - lookups the auth path makes on every request shared through KV
//   - the Airtable webhook route
//   - Server-Timing on every response
// ---------------------------------------------------------------------------

import { fakeAirtable, requestedFields, type FakeTables } from "./helpers/airtable";
import { fakeKv } from "./helpers/kv";
import { getShared, invalidateAll, invalidateShared, rawReadTtl, WEBHOOK_BACKED_TTL_MS } from "../worker/src/cache";
import { resetMissingFieldCache } from "../worker/src/airtable";
import { getPlayerByEmail, getReferenceData, getTeamCoachLinks } from "../worker/src/reference";
import { getAllMatches, getSeasonContext } from "../worker/src/seasonContext";
import { getPlayedMatches, getScheduledMatches, SCHEDULED_MATCHES_KEY } from "../worker/src/fixtures";
import { getRankingEvents, RANKING_EVENTS_FIELDS } from "../worker/src/rankingEvents";
import { PEOPLE_FIELDS, MATCHCARDS_FIELDS } from "../shared/schema/fieldMaps";
import { newRequestStats, runWithRequestContext } from "../worker/src/requestContext";
import { handleAirtableWebhook, signWebhookBody, webhookConfigured, WEBHOOK_ROUTE } from "../worker/src/airtableWebhook";
import worker from "../worker/src/index";

const ENV = {
  AIRTABLE_TOKEN: "***",
  AIRTABLE_BASE_ID: "appTest",
  CALENDAR_SECRET: "***",
  ALLOWED_ORIGIN: "https://app.test",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

const THIS_SEASON = "2026-2027";
const LAST_SEASON = "2025-2026";

function tables(): FakeTables {
  return {
    Teams: [
      { id: "recTA", fields: { "Team Name": "A", "Team Rank": 1, Active: true, Coach: ["recCoach"] } },
      { id: "recTB", fields: { "Team Name": "B", "Team Rank": 2, Active: true, "Section Captain": ["recCap"] } },
    ],
    People: [
      {
        id: "recP1",
        fields: {
          "Preferred Name": "Ann", Surname: "A", Email: "ann@hkfc.com", Active: true,
          "Registered Team": "A", "Playing Position": "Forward", "Playing Ability": "B", Status: "Active",
          // CRM-only fields the app must never ask for.
          HKID: [{ url: "https://dl.airtable.com/hkid.png" }], "Sponsor: Signature": [{ url: "x" }],
        },
      },
      { id: "recCoach", fields: { "Preferred Name": "Cy", Email: "cy@hkfc.com", Active: true, "Registered Team": "A", Status: "Active" } },
    ],
    Matches: [
      { id: "recM1", fields: { Date: "2026-09-12T09:00:00.000Z", Season: THIS_SEASON, "Home Team": "A", "Away Team": "Valley", "Match Status": "Played", "Home Score": 2, "Away Score": 1 } },
      { id: "recM2", fields: { Date: "2026-09-26T09:00:00.000Z", Season: THIS_SEASON, "Home Team": "A", "Away Team": "KCC", "Match Status": "Scheduled" } },
      { id: "recM0", fields: { Date: "2026-03-07T09:00:00.000Z", Season: LAST_SEASON, "Home Team": "A", "Away Team": "Valley", "Match Status": "Played" } },
      { id: "recMOld", fields: { Date: "2019-11-02T09:00:00.000Z", Season: "2019-2020", "Home Team": "A", "Away Team": "Valley", "Match Status": "Played" } },
    ],
    "Match Cards": [
      { id: "recC1", fields: { Player: ["recP1"], Match: ["recM1"], Team: "A", "Player Team": "A", Season: THIS_SEASON } },
      { id: "recC0", fields: { Player: ["recP1"], Match: ["recM0"], Team: "A", "Player Team": "A", Season: LAST_SEASON, Cards: ["Y1"] } },
      { id: "recC0b", fields: { Player: ["recP1"], Match: ["recM0"], Team: "A", "Player Team": "A", Season: LAST_SEASON } },
    ],
    "Availability Exceptions": [],
    "Availability Rules": [],
    "Ranking Events": [
      { id: "recEv1", fields: { Player: ["recP1"], Kind: "move", "Old Rank": 2, "New Rank": 1, Timestamp: new Date().toISOString() } },
    ],
  };
}

let handle: ReturnType<typeof fakeAirtable>;

beforeEach(() => {
  invalidateAll();
  handle = fakeAirtable(tables());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const callsTo = (table: string) => handle.calls.filter((c) => decodeURIComponent(c.url).includes(`/${table}?`) || decodeURIComponent(c.url).includes(`/${table}/`));
// URLSearchParams writes spaces as "+", which decodeURIComponent leaves alone.
const decoded = (url: string) => decodeURIComponent(url.replace(/\+/g, " "));

describe("field projection", () => {
  it("asks People for exactly the fields the mapper reads, never the CRM", async () => {
    await getReferenceData(ENV);
    const people = callsTo("People");
    expect(people.length).toBe(1);
    const fields = requestedFields(people[0].url);
    expect(fields).toEqual(Object.values(PEOPLE_FIELDS));
    expect(fields).not.toContain("HKID");
  });

  it("projects every cached table, not just People", async () => {
    await getSeasonContext(ENV, THIS_SEASON);
    for (const table of ["Teams", "Matches", "Match Cards", "Availability Exceptions"]) {
      for (const call of callsTo(table)) {
        expect(requestedFields(call.url), `${table} read without a projection`).not.toBeNull();
      }
    }
  });

  it("lets a table outside the field maps declare its own projection", async () => {
    await getRankingEvents(ENV, 7);
    const events = callsTo("Ranking Events");
    expect(events.length).toBe(1);
    expect(requestedFields(events[0].url)).toEqual(Object.values(RANKING_EVENTS_FIELDS));
  });
});

describe("season scans", () => {
  it("reads only carded appearances from the previous season", async () => {
    const ctx = await getSeasonContext(ENV, THIS_SEASON);
    const previous = callsTo("Match Cards").map((c) => decoded(c.url)).filter((u) => u.includes(LAST_SEASON));
    expect(previous.length).toBe(1);
    expect(previous[0]).toContain(`{${MATCHCARDS_FIELDS.cards}}!=""`);
    // The fake evaluates that clause, so the uncarded appearance is gone
    // while the suspension input survives.
    expect(ctx.previousCards.map((c) => c.id)).toEqual(["recC0"]);
    expect(ctx.matchCards.map((c) => c.id)).toEqual(["recC1"]);
  });

  it("bounds recently played matches to this season and last", async () => {
    const played = await getPlayedMatches(ENV);
    expect(played.map((m) => m.id).sort()).toEqual(["recM0", "recM1"]);
    const formula = decoded(callsTo("Matches")[0].url);
    expect(formula).toContain(`{Match Status}="Played"`);
    expect(formula).toContain(`{Season}="${THIS_SEASON}"`);
    expect(formula).not.toContain("2019-2020");
  });
});

describe("shared cache lifetimes", () => {
  // Selections live in match records. When an invalidation fails - the KV
  // quota ran out on 2026-09-23 - a six-hour copy showed the coach dashboard
  // 0/14 for a squad saved hours before. These reads stay at ten minutes.
  it("keeps the reads that carry selections short, even with the webhook set up", async () => {
    const kv = fakeKv();
    const env = { ...ENV, AIRTABLE_WEBHOOK_ID: "achTest", AIRTABLE_WEBHOOK_SECRET: "x", CACHE: kv };
    await getScheduledMatches(env);
    await getAllMatches(env, THIS_SEASON);
    expect(kv.store.get(SCHEDULED_MATCHES_KEY)?.ttl).toBe(600);
    expect(kv.store.get(`all-matches:${THIS_SEASON}@0`)?.ttl).toBe(600);
  });

  it("retires the old scheduled-matches entry by reading a new key", async () => {
    const kv = fakeKv();
    await kv.put("scheduled-matches", JSON.stringify([{ id: "stale" }]));
    const matches = await getScheduledMatches({ ...ENV, CACHE: kv });
    expect(matches.map((m) => m.id)).not.toContain("stale");
  });

  it("stretches the TTL only when BOTH webhook settings are present", () => {
    expect(rawReadTtl({}, 600_000)).toBe(600_000);
    // The half-configured states are the dangerous ones, and they are not
    // hypothetical - the first real set-up stored the secret while the id
    // was still commented out. Keying on the secret alone stretched every
    // cache to six hours with no working route to invalidate it, which is
    // worse than having no webhook at all.
    expect(rawReadTtl({ AIRTABLE_WEBHOOK_SECRET: "x" }, 600_000)).toBe(600_000);
    expect(rawReadTtl({ AIRTABLE_WEBHOOK_ID: "achTest" }, 600_000)).toBe(600_000);
    expect(rawReadTtl({ AIRTABLE_WEBHOOK_ID: "achTest", AIRTABLE_WEBHOOK_SECRET: "x" }, 600_000)).toBe(
      WEBHOOK_BACKED_TTL_MS,
    );
  });

  // The two predicates must move together; this is what makes every
  // partial set-up safe rather than merely currently-correct.
  it("agrees with the route's own view of whether a webhook is configured", () => {
    for (const env of [
      {},
      { AIRTABLE_WEBHOOK_SECRET: "x" },
      { AIRTABLE_WEBHOOK_ID: "achTest" },
      { AIRTABLE_WEBHOOK_ID: "achTest", AIRTABLE_WEBHOOK_SECRET: "x" },
    ]) {
      const stretched = rawReadTtl(env, 600_000) === WEBHOOK_BACKED_TTL_MS;
      expect(stretched, `disagreement for ${JSON.stringify(env)}`).toBe(webhookConfigured(env as any));
    }
  });

  it("caps the in-isolate copy of a shared entry at a minute whatever KV's TTL is", async () => {
    vi.useFakeTimers();
    const kv = fakeKv();
    const env = { CACHE: kv };
    let fetches = 0;
    const fetcher = async () => { fetches++; return ["v"]; };

    await getShared(env, "k", fetcher, WEBHOOK_BACKED_TTL_MS);
    expect(kv.store.get("k")?.ttl).toBe(WEBHOOK_BACKED_TTL_MS / 1000);
    const readsAfterFirst = kv.reads.length;

    vi.advanceTimersByTime(30_000);
    await getShared(env, "k", fetcher, WEBHOOK_BACKED_TTL_MS);
    expect(kv.reads.length).toBe(readsAfterFirst);

    vi.advanceTimersByTime(31_000);
    await getShared(env, "k", fetcher, WEBHOOK_BACKED_TTL_MS);
    expect(kv.reads.length).toBe(readsAfterFirst + 1);
    expect(fetches).toBe(1);
  });

  it("clears named keys and prefixes before returning, with nothing left for after the response", async () => {
    const kv = fakeKv();
    await kv.put("scheduled-matches", "[]");
    const pending: Promise<unknown>[] = [];

    await runWithRequestContext({ stats: newRequestStats(), waitUntil: (p) => { pending.push(p); } }, () =>
      invalidateShared({ CACHE: kv }, ["scheduled-matches"], ["exceptions:"]),
    );
    expect(kv.store.has("scheduled-matches")).toBe(false);
    // The prefix is one generation write, done inline: no background list().
    expect(kv.writes).toContain("cache-gen:exceptions:");
    expect(pending.length).toBe(0);
  });

  it("shares the per-request auth lookups across isolates", async () => {
    const kv = fakeKv();
    const env = { ...ENV, CACHE: kv };

    const links = await getTeamCoachLinks(env);
    const player = await getPlayerByEmail(env, "cy@hkfc.com");
    expect(links.coachTeamNamesByPersonId.recCoach).toEqual(["A"]);
    expect(player?.id).toBe("recCoach");
    const teamsReads = callsTo("Teams").length;
    const peopleReads = callsTo("People").length;

    invalidateAll(); // another isolate, same KV
    const again = await getTeamCoachLinks(env);
    const playerAgain = await getPlayerByEmail(env, "cy@hkfc.com");
    expect(again.coachTeamNamesByPersonId.recCoach).toEqual(["A"]);
    expect(again.sectionCaptainIds).toEqual(["recCap"]);
    expect(playerAgain?.id).toBe("recCoach");
    expect(callsTo("Teams").length).toBe(teamsReads);
    expect(callsTo("People").length).toBe(peopleReads);
  });
});

describe("Airtable webhook", () => {
  const secret = btoa("webhook-mac-secret");
  const configured = (kv: ReturnType<typeof fakeKv>) => ({
    ...ENV,
    CACHE: kv,
    AIRTABLE_WEBHOOK_ID: "achTest",
    AIRTABLE_WEBHOOK_SECRET: secret,
  });

  function ping(body: string, mac?: string): Request {
    return new Request(`https://api.test${WEBHOOK_ROUTE}`, {
      method: "POST",
      body,
      headers: mac ? { "X-Airtable-Content-MAC": mac } : {},
    });
  }

  /** Airtable's base-level endpoints, which the table fake does not model. */
  function stubWebhookApi(changedTableIds: string[]) {
    const seen = { payloads: 0, refresh: 0 };
    vi.stubGlobal("fetch", vi.fn((url: any, init?: any) => {
      const u = String(url);
      if (u.includes("/webhooks/achTest/payloads")) {
        seen.payloads++;
        const changedTablesById = Object.fromEntries(changedTableIds.map((id) => [id, {}]));
        return Promise.resolve(new Response(JSON.stringify({ payloads: [{ changedTablesById }], cursor: 7, mightHaveMore: false }), { status: 200 }));
      }
      if (u.includes("/webhooks/achTest/refresh") && init?.method === "POST") {
        seen.refresh++;
        return Promise.resolve(new Response("{}", { status: 200 }));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    }));
    return seen;
  }

  it("is not there until a webhook is configured", async () => {
    const res = await handleAirtableWebhook(ping("{}"), ENV);
    expect(res.status).toBe(404);
  });

  it("rejects a ping whose signature does not verify", async () => {
    const kv = fakeKv();
    const seen = stubWebhookApi(["tblAfY7xhjkcKXlGq"]);
    const body = JSON.stringify({ base: { id: "appTest" }, webhook: { id: "achTest" }, timestamp: "t" });
    expect((await handleAirtableWebhook(ping(body), configured(kv))).status).toBe(401);
    expect((await handleAirtableWebhook(ping(body, "hmac-sha256=deadbeef"), configured(kv))).status).toBe(401);
    expect(seen.payloads).toBe(0);
  });

  it("drops only the caches the changed tables feed, and remembers its cursor", async () => {
    const kv = fakeKv();
    await kv.put(`match-cards:${THIS_SEASON}`, "[]");
    await kv.put("club-reference", "{}");
    const seen = stubWebhookApi(["tblAfY7xhjkcKXlGq", "tblpZl6OOdArZCV99"]); // Match Cards + Commitments (CRM, ignored)

    const body = JSON.stringify({ base: { id: "appTest" }, webhook: { id: "achTest" }, timestamp: "t" });
    const mac = `hmac-sha256=${await signWebhookBody(secret, body)}`;
    const res = await handleAirtableWebhook(ping(body, mac), configured(kv));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ invalidated: ["Match Cards"] });

    // Match Cards' prefix moved to a new generation (one write, no list);
    // nothing else the ping did not touch was cleared.
    expect(kv.writes.filter((k) => k.startsWith("cache-gen:"))).toEqual(["cache-gen:match-cards:"]);
    expect(kv.store.has("club-reference")).toBe(true);
    expect(JSON.parse(kv.store.get("airtable-webhook:cursor")!.value)).toBe(7);
    await vi.waitFor(() => expect(seen.refresh).toBe(1));
  });

  it("is routed by the Worker without a session", async () => {
    const res = await worker.fetch(new Request(`https://api.test${WEBHOOK_ROUTE}`, { method: "POST", body: "{}" }), ENV);
    expect(res.status).toBe(404);
  });
});

describe("instrumentation", () => {
  it("reports Airtable and cache work on every response", async () => {
    const res = await worker.fetch(new Request("https://api.test/health?deep=1"), ENV);
    expect(res.status).toBe(200);
    const timing = res.headers.get("Server-Timing") || "";
    expect(timing).toMatch(/airtable;dur=\d+;desc="calls=1 bytes=\d+ 429s=0"/);
    expect(timing).toMatch(/cache;desc="hits=0 misses=1 kv=0"/);
    expect(timing).toMatch(/total;dur=\d+/);
    expect(res.headers.get("Timing-Allow-Origin")).toBe("https://app.test");
  });
});

describe("a mapped field the base does not have", () => {
  // shared/schema/ is hand-maintained against the base, so it can run ahead
  // of it - a field mapped in code before an administrator adds it, or one
  // renamed in Airtable. The projection is derived from that map, so without
  // this the People table (which backs authorization) would 422 on every
  // read and take the whole app down over one absent checkbox.
  it("drops the field, retries, and keeps serving", async () => {
    resetMissingFieldCache();
    let rejected = 0;
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn((url: any, init?: any) => {
      const u = String(url);
      if (u.includes("fields%5B%5D=Opt-In+Only") || u.includes("fields[]=Opt-In Only")) {
        rejected++;
        return Promise.resolve(new Response(
          JSON.stringify({ error: { type: "UNKNOWN_FIELD_NAME", message: 'Unknown field name: "Opt-In Only"' } }),
          { status: 422 },
        ));
      }
      return (real as any)(url, init);
    }));

    const ref = await getReferenceData(ENV);
    expect(rejected).toBe(1);
    expect(ref.players.length).toBeGreaterThan(0);
    expect(ref.players[0].optInOnly).toBe(false);
  });

  it("does not swallow an error that is not about a field we asked for", async () => {
    resetMissingFieldCache();
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve(new Response(
        JSON.stringify({ error: { type: "UNKNOWN_FIELD_NAME", message: 'Unknown field name: "Some Formula Field"' } }),
        { status: 422 },
      )),
    ));
    await expect(getReferenceData(ENV)).rejects.toThrow();
  });
});
