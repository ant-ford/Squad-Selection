import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Ranking Events module (worker/src/rankingEvents.ts)
// ---------------------------------------------------------------------------

import {
  validateJustification,
  selectRankingEventChanges,
  buildRankingEventRecords,
  recordRankingEvents,
  getRankingEvents,
  MAX_JUSTIFICATION_CHARS,
  RANKING_EVENTS_TABLE,
} from "../worker/src/rankingEvents";
import { invalidateAll, getCached } from "../worker/src/cache";
import { getRecentChanges } from "../worker/src/dashboard";
import { HttpError } from "../worker/src/http";

const ENV = {
  AIRTABLE_TOKEN: "***",
  AIRTABLE_BASE_ID: "test-base",
  CALENDAR_SECRET: "***",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

function airtableResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function installFakeAirtable(opts: {
  people?: any[];
  teams?: any[];
  events?: any[];
  failEvents?: boolean;
  failEventsWith?: number;
}) {
  const calls: string[] = [];
  const people = opts.people ?? [];
  const teams = opts.teams ?? [];
  const events = opts.events ?? [];
  const failEvents = opts.failEvents ?? false;

  const fetchMock = vi.fn((url: any, init?: any) => {
    const u = String(url);
    calls.push(u);
    if (!u.includes("api.airtable.com")) {
      return Promise.resolve(new Response("{}", { status: 404 }));
    }
    const table = decodeURIComponent((u.match(/\/v0\/[^/]+\/([^/?]+)/) ?? [])[1] ?? "");
    const method = init?.method ?? "GET";

    if (table === RANKING_EVENTS_TABLE && failEvents) {
      return Promise.resolve(new Response("Table not found", { status: 404 }));
    }
    if (table === RANKING_EVENTS_TABLE && method === "GET" && u.includes("sort=%5B")) {
      // Regression guard for the live root cause: Airtable rejects a single
      // JSON-encoded `sort` parameter with HTTP 422.
      return Promise.resolve(
        new Response(JSON.stringify({ error: { message: "Invalid request: parameter validation failed. Check your request data." } }), { status: 422 }),
      );
    }
    if (table === RANKING_EVENTS_TABLE && method === "GET" && opts.failEventsWith) {
      return Promise.resolve(new Response("Airtable error", { status: opts.failEventsWith }));
    }
    if (table === RANKING_EVENTS_TABLE && method === "POST" && opts.failEventsWith) {
      return Promise.resolve(new Response("Airtable error", { status: opts.failEventsWith }));
    }

    let records: any[] = [];
    if (table === "People") records = people;
    else if (table === "Teams") records = teams;
    else if (table === RANKING_EVENTS_TABLE) records = events;

    if (method === "POST" && table === RANKING_EVENTS_TABLE) {
      const body = JSON.parse(init.body);
      const created = (body.records ?? []).map((r: any, i: number) => ({
        id: `recE${i}`,
        fields: r.fields,
      }));
      events.push(...created);
      return Promise.resolve(airtableResponse({ records: created }));
    }

    const byId = u.match(/\/rec[A-Z0-9]+/);
    if (byId) {
      const found = records.find((r) => u.includes(r.id));
      return Promise.resolve(airtableResponse(found ?? { id: "x", fields: {} }));
    }
    return Promise.resolve(airtableResponse({ records }));
  }) as any;
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

beforeEach(() => {
  invalidateAll();
});

describe("validateJustification", () => {
  it("trims and returns undefined when absent", () => {
    expect(validateJustification(undefined)).toBeUndefined();
    expect(validateJustification(null)).toBeUndefined();
    expect(validateJustification("   ")).toBeUndefined();
  });

  it("accepts exactly 280 characters", () => {
    const note = "x".repeat(MAX_JUSTIFICATION_CHARS);
    expect(validateJustification(note)).toBe(note);
  });

  it("rejects more than 280 characters with a 400 error", () => {
    expect(() => validateJustification("x".repeat(MAX_JUSTIFICATION_CHARS + 1))).toThrow(
      expect.objectContaining({ status: 400, code: "JUSTIFICATION_TOO_LONG" }),
    );
  });
});

describe("selectRankingEventChanges", () => {
  it("records every changed player regardless of move size", () => {
    const out = selectRankingEventChanges([
      { id: "a", oldRank: 5, rank: 5 },   // unchanged -> skipped
      { id: "b", oldRank: 5, rank: 6 },   // +1 shift -> recorded
      { id: "c", oldRank: 10, rank: 3 },  // -7 -> recorded
      { id: "d", oldRank: 3, rank: 9 },   // +6 -> recorded
    ]);
    expect(out).toEqual([
      { id: "b", oldRank: 5, newRank: 6 },
      { id: "c", oldRank: 10, newRank: 3 },
      { id: "d", oldRank: 3, newRank: 9 },
    ]);
  });

  it("records a pure adjacent swap in full", () => {
    const out = selectRankingEventChanges([
      { id: "a", oldRank: 4, rank: 5 },
      { id: "b", oldRank: 5, rank: 4 },
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.id)).toEqual(["a", "b"]);
  });

  it("returns every changed player even for a full-table reorder", () => {
    const updates = Array.from({ length: 25 }, (_, i) => ({
      id: `p${i}`,
      oldRank: i + 1,
      rank: i + 1 + 5,
    }));
    expect(selectRankingEventChanges(updates)).toHaveLength(25);
  });
});

describe("buildRankingEventRecords", () => {
  it("stamps a single server-side timestamp for the whole batch", () => {
    const now = new Date("2026-08-14T08:00:00.000Z");
    const out = buildRankingEventRecords(
      [
        { playerId: "recP1", actorEmail: "coach@hkfc.com", kind: "move", oldRank: 10, newRank: 3, justification: "form" },
        { playerId: "recP2", actorEmail: "coach@hkfc.com", kind: "move", oldRank: 3, newRank: 10 },
      ],
      now,
    );
    expect(out).toHaveLength(2);
    expect(out[0].timestamp).toBe("2026-08-14T08:00:00.000Z");
    expect(out[1].timestamp).toBe("2026-08-14T08:00:00.000Z");
    expect(out[0].event.justification).toBe("form");
  });
});

describe("recordRankingEvents", () => {
  it("resolves the actor id from the session email and writes to the table", async () => {
    const { calls } = installFakeAirtable({
      people: [{ id: "recCoach", fields: { Email: "coach@hkfc.com", "Preferred Name": "C" } }],
      events: [],
    });
    await recordRankingEvents(ENV, [
      { playerId: "recP1", actorEmail: "coach@hkfc.com", kind: "move", oldRank: 10, newRank: 3, justification: "new form" },
    ]);
    expect(calls.some((u) => u.includes("Ranking%20Events") && u.includes("api.airtable.com"))).toBe(true);
    const { getRankingEvents: read } = await import("../worker/src/rankingEvents");
    invalidateAll();
    const changes = await read(ENV, 7);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      playerId: "recP1",
      kind: "move",
      playerName: "Player",
      actorName: "C",
      oldRank: 10,
      newRank: 3,
      note: "new form",
    });
    expect(typeof changes[0].at).toBe("string");
  });

  it("propagates a real failed write instead of swallowing it (no more fire-and-forget)", async () => {
    installFakeAirtable({ events: [], failEventsWith: 500 });
    await expect(
      recordRankingEvents(ENV, [
        { playerId: "recP1", actorEmail: "coach@hkfc.com", kind: "move", oldRank: 1, newRank: 2 },
      ]),
    ).rejects.toBeInstanceOf(Error);
  });

  it("degrades gracefully when the table does not exist (404) — the rank change is already committed", async () => {
    // The caller has ALREADY written the new Section Rank to People by the
    // time this runs. Rejecting on a 404 would report a successful move as a
    // 502 and invite the coach to redo it, so a missing audit table must not
    // fail the request - matching getRankingEvents' documented 404 carve-out.
    installFakeAirtable({ events: [], failEvents: true });
    await expect(
      recordRankingEvents(ENV, [
        { playerId: "recP1", actorEmail: "coach@hkfc.com", kind: "move", oldRank: 1, newRank: 2 },
      ]),
    ).resolves.toBeUndefined();
  });

  it("commits the event batch before the call resolves (no background write)", async () => {
    const { fetchMock } = installFakeAirtable({
      people: [{ id: "recCoach", fields: { Email: "coach@hkfc.com" } }],
      events: [],
    });
    await recordRankingEvents(ENV, [
      { playerId: "recP1", actorEmail: "coach@hkfc.com", kind: "move", oldRank: 5, newRank: 1 },
    ]);
    // If the write were still fire-and-forget, the POST would still be
    // in flight (or not yet issued) the instant recordRankingEvents resolves.
    const posted = fetchMock.mock.calls.some(
      ([url, init]: [string, any]) =>
        String(url).includes("Ranking%20Events") && init?.method === "POST",
    );
    expect(posted).toBe(true);
  });

  it("chunks large audits into batches of 10 create requests", async () => {
    const { calls } = installFakeAirtable({ people: [], events: [] });
    const events = Array.from({ length: 25 }, (_, i) => ({
      playerId: `recP${i}`,
      actorEmail: "coach@hkfc.com",
      kind: "move" as const,
      oldRank: i + 1,
      newRank: i + 2,
    }));
    await recordRankingEvents(ENV, events);
    const posts = calls.filter((u) => u.includes("Ranking%20Events") && u.includes("api.airtable.com"));
    expect(posts).toHaveLength(3); // 10 + 10 + 5
    invalidateAll();
    const changes = await getRankingEvents(ENV, 7);
    // All 25 were written; the read is capped at the 20 newest (if only one
    // batch had been written, the read would return 10, not 20).
    expect(changes).toHaveLength(20);
  });
});

describe("getRankingEvents", () => {
  it("returns [] when the table does not exist", async () => {
    installFakeAirtable({ events: [], failEvents: true });
    const changes = await getRankingEvents(ENV, 7);
    expect(changes).toEqual([]);
  });

  it("filters by the requested window and returns newest first", async () => {
    const now = Date.now();
    const events = [
      { id: "recE1", fields: { "Old Rank": 1, "New Rank": 5, Timestamp: new Date(now - 2 * 86400_000).toISOString(), "Actor Email": "c@hkfc.com", Kind: "move" } },
      { id: "recE2", fields: { "Old Rank": 5, "New Rank": 1, Timestamp: new Date(now - 400 * 86400_000).toISOString(), "Actor Email": "c@hkfc.com", Kind: "move" } },
    ];
    installFakeAirtable({
      events,
      people: [{ id: "recP1", fields: { "Preferred Name": "Bob" } }],
      teams: [],
    });
    const changes = await getRankingEvents(ENV, 7);
    expect(changes.map((c) => c.id)).toEqual(["recE1"]);
    expect(changes[0]).toMatchObject({ oldRank: 1, newRank: 5, kind: "move" });
  });

  it("caps the returned list at the 20 newest changes", async () => {
    const now = Date.now();
    const events = Array.from({ length: 25 }, (_, i) => ({
      id: `recE${i}`,
      fields: {
        "Old Rank": i,
        "New Rank": i + 1,
        Kind: "move",
        Timestamp: new Date(now - i * 3600_000).toISOString(),
      },
    }));
    installFakeAirtable({ events, people: [], teams: [] });
    const changes = await getRankingEvents(ENV, 30);
    expect(changes).toHaveLength(20);
  });
});

// ---------------------------------------------------------------------------
// Read-path regression tests (Ranking Events -> Recent Ranking Changes)
// ---------------------------------------------------------------------------

describe("getRankingEvents read path", () => {
  it("requests the sort in Airtable's bracket format (regression: the JSON-blob sort was rejected with 422)", async () => {
    const { calls } = installFakeAirtable({
      events: [{ id: "recE1", fields: { Kind: "move", "Old Rank": 4, "New Rank": 2, Timestamp: new Date().toISOString() } }],
      people: [],
      teams: [],
    });
    const changes = await getRankingEvents(ENV, 7);
    expect(changes).toHaveLength(1);
    expect(calls.some((u) => u.includes("sort%5B0%5D%5Bfield%5D=Timestamp"))).toBe(true);
    expect(calls.some((u) => u.includes("sort%5B0%5D%5Bdirection%5D=desc"))).toBe(true);
    // The old broken format must never be sent again.
    expect(calls.some((u) => u.includes("sort=%5B"))).toBe(false);
  });

  it("returns [] for an existing but empty table", async () => {
    installFakeAirtable({ events: [], people: [], teams: [] });
    const changes = await getRankingEvents(ENV, 7);
    expect(changes).toEqual([]);
  });

  it("propagates an Airtable read failure instead of silently returning an empty success", async () => {
    installFakeAirtable({ events: [], failEventsWith: 500 });
    await expect(getRankingEvents(ENV, 7)).rejects.toMatchObject({
      code: "RANKING_EVENTS_UNAVAILABLE",
      status: 502,
    });
  });

  it("keeps the graceful [] degradation only for a missing table (404)", async () => {
    installFakeAirtable({ events: [], failEvents: true });
    await expect(getRankingEvents(ENV, 7)).resolves.toEqual([]);
  });
});

describe("getRecentChanges API layer", () => {
  it("returns recorded events for the API response", async () => {
    const now = Date.now();
    installFakeAirtable({
      events: [
        {
          id: "recE1",
          fields: {
            Kind: "move",
            "Old Rank": 4,
            "New Rank": 2,
            Timestamp: new Date(now - 3_600_000).toISOString(),
            "Actor Email": "c@hkfc.com",
            Player: ["recP1"],
          },
        },
      ],
      people: [{ id: "recP1", fields: { "Preferred Name": "Bob", Email: "c@hkfc.com" } }],
      teams: [],
    });
    const out = await getRecentChanges(ENV, 7);
    expect(out.changes).toHaveLength(1);
    expect(out.changes[0]).toMatchObject({
      playerId: "recP1",
      kind: "move",
      oldRank: 4,
      newRank: 2,
      playerName: "Bob",
    });
  });

  it("propagates read failures to the API layer instead of returning { changes: [] }", async () => {
    installFakeAirtable({ events: [], failEventsWith: 422 });
    await expect(getRecentChanges(ENV, 7)).rejects.toBeInstanceOf(HttpError);
  });
});

describe("ranking-events cache invalidation", () => {
  it("drops the cached read after events are recorded (no 60s staleness)", async () => {
    installFakeAirtable({
      people: [{ id: "recCoach", fields: { Email: "coach@hkfc.com" } }],
      events: [],
    });
    await getCached("ranking-events:7", async () => "STALE", 60_000);
    await recordRankingEvents(ENV, [
      { playerId: "recP1", actorEmail: "coach@hkfc.com", kind: "move", oldRank: 3, newRank: 2 },
    ]);
    const { data, fromCache } = await getCached("ranking-events:7", async () => "FRESH");
    expect(fromCache).toBe(false);
    expect(data).toBe("FRESH");
  });
});