import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Tier-0 Airtable access fixes (docs/ARCHITECTURE_ASSESSMENT_2026-09-19.md):
//   - field projection: People is a 300-field CRM, the app reads 27 of them
//   - previous-season Match Cards narrowed to carded appearances
//   - "Show past" bounded to two seasons instead of every result ever
//   - the in-isolate copy of a shared entry capped at a minute
//   - prefix invalidation handed to ctx.waitUntil
//   - lookups the auth path makes on every request shared through KV
//   - Server-Timing on every response
// ---------------------------------------------------------------------------

import { fakeAirtable, requestedFields, type FakeTables } from "./helpers/airtable";
import { fakeKv } from "./helpers/kv";
import { getShared, invalidateAll, invalidateShared } from "../worker/src/cache";
import { resetMissingFieldCache } from "../worker/src/airtable";
import { getOfficerLinks, getPlayerByEmail, getReferenceData, getTeamCoachLinks } from "../worker/src/reference";
import { getAllMatches, getSeasonContext } from "../worker/src/seasonContext";
import { getPlayedMatches, getScheduledMatches, SCHEDULED_MATCHES_KEY } from "../worker/src/fixtures";
import { getRankingEvents, RANKING_EVENTS_FIELDS } from "../worker/src/rankingEvents";
import { PEOPLE_FIELDS, MATCHCARDS_FIELDS, OFFICER_FIELDS } from "../shared/schema/fieldMaps";
import { newRequestStats, runWithRequestContext } from "../worker/src/requestContext";
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
    "Membership Officers": [
      { id: "recMO1", fields: { Status: "Active", Designation: "Men's Membership Officer", Member: ["recP1"], "Signature (from Member)": [{ url: "x" }] } },
      { id: "recMO0", fields: { Status: "Retired", Designation: "Men's Membership Officer", Member: ["recCoach"] } },
    ],
    "Section Chairs": [
      { id: "recSC1", fields: { Status: "Active", Designation: "Chairman", Member: ["recCoach"] } },
    ],
    "Section Captains": [
      { id: "recCP1", fields: { Status: "Active", Designation: "Men's Captain", Member: ["recCoach"] } },
      { id: "recCP0", fields: { Status: "Retired", Designation: "Men's Captain", Member: ["recP1"] } },
    ],
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

describe("officer links", () => {
  it("keeps Active rows only, keyed by the linked People record", async () => {
    const links = await getOfficerLinks(ENV);
    expect(links.rolesByPersonId).toEqual({
      recP1: [{ office: "membershipOfficer", designation: "Men's Membership Officer" }],
      // The Retired Membership Officer and Section Captain rows grant nothing.
      recCoach: [
        { office: "sectionChair", designation: "Chairman" },
        { office: "sectionCaptain", designation: "Men's Captain" },
      ],
    });
  });

  it("reads only Status, Designation and Member, never the signature lookups", async () => {
    await getOfficerLinks(ENV);
    for (const table of ["Membership Officers", "Section Chairs", "Section Captains"]) {
      const calls = callsTo(table);
      expect(calls.length).toBe(1);
      expect(requestedFields(calls[0].url)).toEqual(Object.values(OFFICER_FIELDS));
    }
  });

  it("is shared across isolates through KV", async () => {
    const env = { ...ENV, CACHE: fakeKv() };
    await getOfficerLinks(env);
    invalidateAll(); // another isolate, same KV
    const again = await getOfficerLinks(env);
    expect(again.rolesByPersonId.recP1).toHaveLength(1);
    expect(callsTo("Membership Officers").length).toBe(1);
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
  it("keeps the reads that carry selections short", async () => {
    const kv = fakeKv();
    const env = { ...ENV, CACHE: kv };
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

  it("caps the in-isolate copy of a shared entry at a minute whatever KV's TTL is", async () => {
    vi.useFakeTimers();
    const kv = fakeKv();
    const env = { CACHE: kv };
    let fetches = 0;
    const fetcher = async () => { fetches++; return ["v"]; };
    const sixHours = 6 * 60 * 60 * 1000;

    await getShared(env, "k", fetcher, sixHours);
    expect(kv.store.get("k")?.ttl).toBe(sixHours / 1000);
    const readsAfterFirst = kv.reads.length;

    vi.advanceTimersByTime(30_000);
    await getShared(env, "k", fetcher, sixHours);
    expect(kv.reads.length).toBe(readsAfterFirst);

    vi.advanceTimersByTime(31_000);
    await getShared(env, "k", fetcher, sixHours);
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
