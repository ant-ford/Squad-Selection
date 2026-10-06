import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Ranking Events module (worker/src/rankingEvents.ts)
//
// The reads and writes run on the Supabase path: the real repositories
// against fakePostgrest (tests/helpers/rankingDb.ts). A write is one
// insert_ranking_events call; the read is api_ranking_events.
//
// The three tests at the end (the missing-table carve-out) still run on
// Airtable: rankingEvents.ts only forgives an AirtableError 404, so that rule
// does not hold on Supabase. See the note on that block.
// ---------------------------------------------------------------------------

import {
  validateJustification,
  selectRankingEventChanges,
  withoutKnockOnShifts,
  buildRankingEventRecords,
  recordRankingEvents,
  getRankingEvents,
  MAX_JUSTIFICATION_CHARS,
  RANKING_EVENTS_TABLE,
} from "../worker/src/rankingEvents";
import { invalidateAll, getCached } from "../worker/src/cache";
import { getRecentChanges } from "../worker/src/dashboard";
import { HttpError } from "../worker/src/http";
import { SupabaseError } from "../worker/src/data/supabase";
import type { Env } from "../worker/src/env";
import { SUPABASE_TEST_ENV } from "./helpers/postgrest";
import { recId } from "./helpers/factories";
import { personRow, rankingDb, rankingEventRow, type RankingDb } from "./helpers/rankingDb";
import type { PgRow } from "./helpers/postgrest";

const ENV = { ...SUPABASE_TEST_ENV } as unknown as Env;

const COACH = recId("Coach");
const P1 = recId("P1");

const failWith = (status: number) => () =>
  new Response(JSON.stringify({ code: "XX000", message: "upstream error" }), { status, headers: { "Content-Type": "application/json" } });

let db: RankingDb;

beforeEach(() => {
  invalidateAll();
});

afterEach(() => {
  vi.unstubAllGlobals();
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

describe("withoutKnockOnShifts", () => {
  const TS = "2026-09-30T08:00:00.000Z";
  const ev = (name: string, oldRank: number | null, newRank: number | null, over: Record<string, unknown> = {}) => ({
    name,
    kind: "reorder",
    actorEmail: "coach@example.com",
    timestamp: TS,
    oldRank,
    newRank,
    ...over,
  });
  const names = (rows: { name: string }[]) => rows.map((r) => r.name);

  it("keeps only the player moved up, not the three shifted down", () => {
    const rows = [ev("A", 5, 2), ev("B", 2, 3), ev("C", 3, 4), ev("D", 4, 5)];
    expect(names(withoutKnockOnShifts(rows))).toEqual(["A"]);
  });

  it("keeps only the player moved down", () => {
    const rows = [ev("A", 2, 6), ev("B", 3, 2), ev("C", 4, 3), ev("D", 5, 4), ev("E", 6, 5)];
    expect(names(withoutKnockOnShifts(rows))).toEqual(["A"]);
  });

  it("keeps both players moved in one save", () => {
    // A 10 -> 1 and B 3 -> 8 saved together.
    const before = ["P1", "P2", "B", "P4", "P5", "P6", "P7", "P8", "P9", "A"];
    const after = ["A", "P1", "P2", "P4", "P5", "P6", "P7", "B", "P8", "P9"];
    const rows = before
      .map((n, i) => ev(n, i + 1, after.indexOf(n) + 1))
      .filter((r) => r.oldRank !== r.newRank);
    expect(names(withoutKnockOnShifts(rows)).sort()).toEqual(["A", "B"]);
  });

  it("keeps both players when two swap over players who stayed put", () => {
    const rows = [ev("A", 2, 6), ev("B", 6, 2)];
    expect(names(withoutKnockOnShifts(rows))).toEqual(["A", "B"]);
  });

  it("keeps both sides of a one-place swap", () => {
    const rows = [ev("A", 4, 3), ev("B", 3, 4)];
    expect(names(withoutKnockOnShifts(rows))).toEqual(["A", "B"]);
  });

  it("treats separate saves separately", () => {
    const rows = [
      ev("A", 5, 2), ev("B", 2, 3), ev("C", 3, 4), ev("D", 4, 5),
      ev("E", 9, 7, { timestamp: "2026-09-29T08:00:00.000Z" }),
      ev("F", 7, 8, { timestamp: "2026-09-29T08:00:00.000Z" }),
      ev("G", 8, 9, { timestamp: "2026-09-29T08:00:00.000Z" }),
    ];
    expect(names(withoutKnockOnShifts(rows))).toEqual(["A", "E"]);
  });

  it("leaves activations and deactivations alone", () => {
    const rows = [ev("A", null, 4, { kind: "activate" }), ev("B", 7, null, { kind: "deactivate" })];
    expect(names(withoutKnockOnShifts(rows))).toEqual(["A", "B"]);
  });

  it("keeps newest-first order", () => {
    const rows = [
      ev("E", 9, 7, { timestamp: "2026-09-30T09:00:00.000Z" }),
      ev("B", 2, 3), ev("A", 5, 2), ev("C", 3, 4), ev("D", 4, 5),
    ];
    expect(names(withoutKnockOnShifts(rows))).toEqual(["E", "A"]);
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


/** The coach whose session email resolves to the actor, and P1, a player with no name on file. */
function coachAndPlayer() {
  return [
    personRow("Coach", { email: "coach@hkfc.com", preferred_name: "C", active: true }),
    // In People (insert_ranking_events resolves the id) but not Active, and
    // with no name: the read falls back to "Player".
    personRow("P1", { email: null, preferred_name: null, active: false }),
  ];
}

describe("recordRankingEvents", () => {
  it("resolves the actor id from the session email and writes to the table", async () => {
    db = rankingDb({ people: coachAndPlayer() });
    await recordRankingEvents(ENV, [
      { playerId: P1, actorEmail: "coach@hkfc.com", kind: "move", oldRank: 10, newRank: 3, justification: "new form" },
    ]);
    // Supabase: the write is the insert_ranking_events call, with the actor
    // resolved from the session email (was: a POST to the Airtable table).
    expect(db.pg.rpcCalls("insert_ranking_events")[0].p[0]).toMatchObject({ playerId: P1, actorId: COACH, actorEmail: "coach@hkfc.com" });
    const { getRankingEvents: read } = await import("../worker/src/rankingEvents");
    invalidateAll();
    const changes = await read(ENV, 7);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      playerId: P1,
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
    db = rankingDb({ people: coachAndPlayer(), handlers: { "rpc/insert_ranking_events": failWith(500) } });
    await expect(
      recordRankingEvents(ENV, [
        { playerId: P1, actorEmail: "coach@hkfc.com", kind: "move", oldRank: 1, newRank: 2 },
      ]),
    ).rejects.toBeInstanceOf(Error);
  });

  it("commits the event batch before the call resolves (no background write)", async () => {
    db = rankingDb({ people: coachAndPlayer() });
    await recordRankingEvents(ENV, [
      { playerId: P1, actorEmail: "coach@hkfc.com", kind: "move", oldRank: 5, newRank: 1 },
    ]);
    // If the write were still fire-and-forget, the call would still be in
    // flight (or not yet issued) the instant recordRankingEvents resolves.
    expect(db.pg.rpcCalls("insert_ranking_events")).toHaveLength(1);
    expect(db.events).toHaveLength(1);
  });

  it("writes a large audit in full, in one insert_ranking_events call", async () => {
    // Supabase: one call (one transaction) for every event. Airtable took 10
    // records per create request, so this used to assert 3 requests (10+10+5).
    db = rankingDb({ people: Array.from({ length: 25 }, (_, i) => personRow(`P${i}`, { active: false })) });
    const events = Array.from({ length: 25 }, (_, i) => ({
      playerId: recId(`P${i}`),
      actorEmail: "coach@hkfc.com",
      kind: "move" as const,
      oldRank: i + 1,
      newRank: i + 2,
    }));
    await recordRankingEvents(ENV, events);
    const calls = db.pg.rpcCalls("insert_ranking_events");
    expect(calls).toHaveLength(1);
    expect(calls[0].p).toHaveLength(25);
    invalidateAll();
    const changes = await getRankingEvents(ENV, 7);
    // All 25 were written; the read is capped at the 20 newest.
    expect(changes).toHaveLength(20);
  });
});

describe("getRankingEvents", () => {
  it("filters by the requested window and returns newest first", async () => {
    const now = Date.now();
    db = rankingDb({
      events: [
        rankingEventRow({ id: recId("E1"), old_rank: 1, new_rank: 5, occurred_at: new Date(now - 2 * 86400_000).toISOString(), actor_email: "c@hkfc.com", kind: "move" }),
        rankingEventRow({ id: recId("E2"), old_rank: 5, new_rank: 1, occurred_at: new Date(now - 400 * 86400_000).toISOString(), actor_email: "c@hkfc.com", kind: "move" }),
      ],
      people: [personRow("P1", { preferred_name: "Bob", email: null, active: true })],
    });
    const changes = await getRankingEvents(ENV, 7);
    expect(changes.map((c) => c.id)).toEqual([recId("E1")]);
    expect(changes[0]).toMatchObject({ oldRank: 1, newRank: 5, kind: "move" });
  });

  it("caps the returned list at the 20 newest changes", async () => {
    const now = Date.now();
    const events: PgRow[] = Array.from({ length: 25 }, (_, i) =>
      rankingEventRow({
        id: recId(`E${i}`),
        old_rank: i,
        new_rank: i + 1,
        kind: "move",
        occurred_at: new Date(now - i * 3600_000).toISOString(),
      }),
    );
    db = rankingDb({ events });
    const changes = await getRankingEvents(ENV, 30);
    expect(changes).toHaveLength(20);
  });
});

// ---------------------------------------------------------------------------
// Read-path regression tests (Ranking Events -> Recent Ranking Changes)
// ---------------------------------------------------------------------------

describe("getRankingEvents read path", () => {
  it("asks for newest first, with a total order for paging (was: Airtable's bracket sort format)", async () => {
    // Supabase: the sort is PostgREST's order=occurred_at.desc. The old
    // regression (Airtable rejected a JSON-blob sort with 422) has no
    // equivalent; what matters now is the direction and the id tiebreaker
    // that keeps pages from skipping rows that share a timestamp.
    db = rankingDb({
      events: [rankingEventRow({ id: recId("E1"), kind: "move", old_rank: 4, new_rank: 2, occurred_at: new Date().toISOString() })],
    });
    const changes = await getRankingEvents(ENV, 7);
    expect(changes).toHaveLength(1);
    const order = db.pg.reads("api_ranking_events").map((c) => c.params.get("order"));
    expect(order.every((o) => o?.startsWith("occurred_at.desc"))).toBe(true);
    expect(order.every((o) => o?.split(",").includes("id"))).toBe(true);
    // Airtable's sort parameters must never be sent.
    expect(db.pg.reads("api_ranking_events").some((c) => [...c.params.keys()].some((k) => k.startsWith("sort")))).toBe(false);
  });

  it("returns [] for an existing but empty table", async () => {
    db = rankingDb();
    const changes = await getRankingEvents(ENV, 7);
    expect(changes).toEqual([]);
  });

  it("propagates a read failure instead of silently returning an empty success", async () => {
    db = rankingDb({ handlers: { api_ranking_events: failWith(500) } });
    await expect(getRankingEvents(ENV, 7)).rejects.toMatchObject({
      code: "RANKING_EVENTS_UNAVAILABLE",
      status: 502,
    });
  });
});

describe("getRecentChanges API layer", () => {
  it("returns recorded events for the API response", async () => {
    const now = Date.now();
    db = rankingDb({
      events: [
        rankingEventRow({
          id: recId("E1"),
          kind: "move",
          old_rank: 4,
          new_rank: 2,
          occurred_at: new Date(now - 3_600_000).toISOString(),
          actor_email: "c@hkfc.com",
          player: P1,
        }),
      ],
      people: [personRow("P1", { preferred_name: "Bob", email: "c@hkfc.com", active: true })],
    });
    const out = await getRecentChanges(ENV, 7);
    expect(out.changes).toHaveLength(1);
    expect(out.changes[0]).toMatchObject({
      playerId: P1,
      kind: "move",
      oldRank: 4,
      newRank: 2,
      playerName: "Bob",
    });
  });

  it("propagates read failures to the API layer instead of returning { changes: [] }", async () => {
    db = rankingDb({ handlers: { api_ranking_events: failWith(422) } });
    await expect(getRecentChanges(ENV, 7)).rejects.toBeInstanceOf(HttpError);
  });
});

describe("ranking-events cache invalidation", () => {
  it("drops the cached read after events are recorded (no 60s staleness)", async () => {
    db = rankingDb({ people: coachAndPlayer() });
    await getCached("ranking-events:7", async () => "STALE", 60_000);
    await recordRankingEvents(ENV, [
      { playerId: P1, actorEmail: "coach@hkfc.com", kind: "move", oldRank: 3, newRank: 2 },
    ]);
    const { data, fromCache } = await getCached("ranking-events:7", async () => "FRESH");
    expect(fromCache).toBe(false);
    expect(data).toBe("FRESH");
  });
});

// ---------------------------------------------------------------------------
// NOT CONVERTED: the missing-table carve-out (Airtable only).
//
// recordRankingEvents and getRankingEvents forgive a missing table only when
// the error is an AirtableError with status 404. On Supabase a missing
// relation or function is a SupabaseError (PostgREST answers 404), which is
// not forgiven: the write rejects and the read becomes a 502. So these three
// rules do not hold on the Supabase path, and are kept here, on Airtable,
// until that is decided (the table always exists on Supabase, so the
// carve-out may simply go with the Airtable code). The Supabase behaviour is
// pinned below so the difference is visible.
// ---------------------------------------------------------------------------

const AIRTABLE_ENV = {
  AIRTABLE_TOKEN: "***",
  AIRTABLE_BASE_ID: "test-base",
  CALENDAR_SECRET: "***",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

/** Airtable answering 404 (table not found) for Ranking Events, an empty table for everything else. */
function installMissingAirtableTable() {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: any) => {
      const u = String(url);
      if (!u.includes("api.airtable.com")) return Promise.resolve(new Response("{}", { status: 404 }));
      const table = decodeURIComponent((u.match(/\/v0\/[^/]+\/([^/?]+)/) ?? [])[1] ?? "");
      if (table === RANKING_EVENTS_TABLE) return Promise.resolve(new Response("Table not found", { status: 404 }));
      return Promise.resolve(new Response(JSON.stringify({ records: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }),
  );
}

describe("missing Ranking Events table (Airtable only; see the note above)", () => {
  it("degrades gracefully when the table does not exist (404) — the rank change is already committed", async () => {
    // The caller has ALREADY written the new Section Rank to People by the
    // time this runs. Rejecting on a 404 would report a successful move as a
    // 502 and invite the coach to redo it, so a missing audit table must not
    // fail the request - matching getRankingEvents' documented 404 carve-out.
    installMissingAirtableTable();
    await expect(
      recordRankingEvents(AIRTABLE_ENV, [
        { playerId: "recP1", actorEmail: "coach@hkfc.com", kind: "move", oldRank: 1, newRank: 2 },
      ]),
    ).resolves.toBeUndefined();
  });

  it("returns [] when the table does not exist", async () => {
    installMissingAirtableTable();
    const changes = await getRankingEvents(AIRTABLE_ENV, 7);
    expect(changes).toEqual([]);
  });

  it("keeps the graceful [] degradation only for a missing table (404)", async () => {
    installMissingAirtableTable();
    await expect(getRankingEvents(AIRTABLE_ENV, 7)).resolves.toEqual([]);
  });

  it("on Supabase, a missing table or function is NOT forgiven (the difference above)", async () => {
    db = rankingDb({ people: coachAndPlayer(), handlers: { "rpc/insert_ranking_events": failWith(404), api_ranking_events: failWith(404) } });
    await expect(
      recordRankingEvents(ENV, [{ playerId: P1, actorEmail: "coach@hkfc.com", kind: "move", oldRank: 1, newRank: 2 }]),
    ).rejects.toBeInstanceOf(SupabaseError);
    await expect(getRankingEvents(ENV, 7)).rejects.toMatchObject({ status: 502, code: "RANKING_EVENTS_UNAVAILABLE" });
  });
});
