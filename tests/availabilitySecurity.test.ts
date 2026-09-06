import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Availability security - cross-player (IDOR) regression tests
//
// Identity for player self-service availability comes ONLY from the verified
// Supabase session (the router derives the email; these tests exercise the
// Worker functions with that session-derived identity). Prove that:
//   - a player can update their OWN availability,
//   - an Airtable exception record ID alone can NEVER modify or delete
//     another player's exception,
//   - the goalkeeper date-level bulk affects only the authenticated keeper's
//     fixtures,
//   - the exception model invariants hold (Available deletes; no Available
//     records; Maybe/Unavailable upsert).
// ---------------------------------------------------------------------------

import { setMyAvailability, setMyAvailabilityForDate } from "../worker/src/availability";
import { invalidateAll } from "../worker/src/cache";

const ENV = {
  AIRTABLE_TOKEN: "***",
  AIRTABLE_BASE_ID: "test-base",
  CALENDAR_SECRET: "***",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

const DATE_KEY = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0];

const TEAMS = ["A", "B", "H"].map((n, i) => ({
  id: `recT${i}`,
  fields: { "Team Name": n, "Team Rank": n === "A" ? 1 : n === "B" ? 2 : 8, Active: true },
}));

const PEOPLE = [
  { id: "recA", fields: { "Preferred Name": "Alice", Email: "player-a@example.com", Active: true, "Registered Team": "B", "Playing Position": "Defender" } },
  { id: "recB", fields: { "Preferred Name": "Bill", Email: "player-b@example.com", Active: true, "Registered Team": "B", "Playing Position": "Forward" } },
  { id: "recGKA", fields: { "Preferred Name": "KeeperA", Email: "gk-a@example.com", Active: true, "Registered Team": "H", "Playing Position": "Goalkeeper" } },
  { id: "recGKB", fields: { "Preferred Name": "KeeperB", Email: "gk-b@example.com", Active: true, "Registered Team": "H", "Playing Position": "Goalkeeper" } },
];

function match(id: string, homeTeam: string, date = DATE_KEY): any {
  return {
    id,
    fields: {
      Date: `${date}T09:00:00.000Z`,
      Season: "2026-2027",
      "Home Team": homeTeam,
      "Away Team": "B",
      "Match Status": "Scheduled",
    },
  };
}

let state: { people: any[]; teams: any[]; matches: any[]; exceptions: any[] };
let nextId: number;

function seed() {
  state = {
    people: PEOPLE.map((p) => ({ id: p.id, fields: { ...p.fields } })),
    teams: TEAMS.map((t) => ({ id: t.id, fields: { ...t.fields } })),
    matches: [match("recM1", "B"), match("recM2", "A"), match("recM3", "H")],
    exceptions: [],
  };
  nextId = 1;
}

function exception(id: string, playerId: string, matchId: string, status = "Unavailable"): any {
  return {
    id,
    fields: {
      Player: [playerId],
      Match: [matchId],
      "Availability Status": status,
      "Player Notes": "",
      "Season (Matches)": "2026-2027",
    },
  };
}

function installFakeAirtable() {
  const fetchMock = vi.fn((url: any, init?: any) => {
    const u = String(url);
    if (!u.includes("api.airtable.com")) return Promise.resolve(new Response("{}", { status: 404 }));
    const table = decodeURIComponent((u.match(/\/v0\/[^/]+\/([^/?]+)/) ?? [])[1] ?? "");
    const method = init?.method ?? "GET";
    const store = (): any[] =>
      table === "People" ? state.people : table === "Teams" ? state.teams : table === "Matches" ? state.matches : table === "Availability Exceptions" ? state.exceptions : [];

    if (method === "POST") {
      const body = JSON.parse(init.body);
      if (body.records) {
        const created = body.records.map((r: any, i: number) => ({ id: `recNew${nextId++}`, fields: r.fields }));
        store().push(...created);
        return Promise.resolve(new Response(JSON.stringify({ records: created }), { status: 200 }));
      }
      const created = { id: `recNew${nextId++}`, fields: body.fields };
      store().push(created);
      return Promise.resolve(new Response(JSON.stringify(created), { status: 200 }));
    }
    if (method === "PATCH") {
      const id = (u.match(/\/rec[A-Za-z0-9]+$/) ?? [])[0]?.slice(1);
      const body = JSON.parse(init.body);
      const target = store().find((r) => r.id === id);
      if (target) target.fields = { ...target.fields, ...body.fields };
      return Promise.resolve(new Response(JSON.stringify(target ?? {}), { status: 200 }));
    }
    if (method === "DELETE") {
      const body = JSON.parse(init.body);
      const ids: string[] = body.records ?? [body];
      for (const id of ids) {
        const idx = store().findIndex((r) => r.id === id);
        if (idx >= 0) store().splice(idx, 1);
      }
      return Promise.resolve(new Response(JSON.stringify({ records: [] }), { status: 200 }));
    }

    // Honest filterByFormula emulation for People email lookups.
    if (table === "People" && u.includes("filterByFormula")) {
      const q = new URLSearchParams(u.split("?")[1] ?? "");
      const formula = decodeURIComponent(q.get("filterByFormula") || "");
      const m = formula.match(/"([^"]+)"/);
      const needle = m ? m[1].toLowerCase() : "";
      const filtered = store().filter((r) => (r.fields?.Email || "").toLowerCase() === needle);
      return Promise.resolve(new Response(JSON.stringify({ records: filtered }), { status: 200 }));
    }

    const byId = u.match(/\/rec[A-Za-z0-9]+$/);
    if (byId) {
      const found = store().find((r) => r.id === byId[0].slice(1));
      if (!found) return Promise.resolve(new Response("Not found", { status: 404 }));
      return Promise.resolve(new Response(JSON.stringify(found), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ records: store() }), { status: 200 }));
  }) as any;
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  invalidateAll();
  seed();
  installFakeAirtable();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normal availability - identity boundary", () => {
  it("a player updates their OWN availability (legitimate)", async () => {
    const out = await setMyAvailability(ENV, {
      email: "player-a@example.com",
      matchId: "recM1",
      status: "Unavailable",
      notes: "Away",
    });
    expect(out.success).toBe(true);
    expect(out.exceptionId).toBeTruthy();
    expect(state.exceptions).toHaveLength(1);
    expect(state.exceptions[0].fields["Player"]).toEqual(["recA"]); // Alice's own record
    expect(state.exceptions[0].fields["Availability Status"]).toBe("Unavailable");
  });

  it("updating the same match never touches another player's exception (modify)", async () => {
    // Bill already has an Unavailable exception on recM1. The Worker now
    // resolves the caller's own exception itself (no client-supplied record
    // ID exists in the request shape any more), so there is no longer a
    // parameter through which Bill's ID could even be offered.
    state.exceptions = [exception("recEB1", "recB", "recM1")];

    const out = await setMyAvailability(ENV, {
      email: "player-a@example.com",
      matchId: "recM1",
      status: "Unavailable",
    });

    // Bill's exception is untouched.
    const billException = state.exceptions.find((e) => e.id === "recEB1");
    expect(billException).toBeTruthy();
    expect(billException.fields["Player"]).toEqual(["recB"]);
    expect(billException.fields["Availability Status"]).toBe("Unavailable");
    // Alice gets her OWN exception instead.
    expect(out.exceptionId).not.toBe("recEB1");
    const aliceException = state.exceptions.find((e) => e.fields["Player"]?.[0] === "recA");
    expect(aliceException).toBeTruthy();
  });

  it("updating the same match never touches another player's exception (delete)", async () => {
    state.exceptions = [exception("recEB1", "recB", "recM1", "Unavailable")];

    // Unavailable -> Available deletes the CALLER's exception only.
    const out = await setMyAvailability(ENV, {
      email: "player-a@example.com",
      matchId: "recM1",
      status: "Available",
    });

    expect(out.exceptionId).toBeNull();
    // Bill's exception still exists (not deleted).
    expect(state.exceptions).toHaveLength(1);
    expect(state.exceptions[0].id).toBe("recEB1");
    expect(state.exceptions[0].fields["Player"]).toEqual(["recB"]);
  });

  it("rejects forged statuses that would corrupt the exception model", async () => {
    await expect(
      setMyAvailability(ENV, { email: "player-a@example.com", matchId: "recM1", status: "Selected" as any }),
    ).rejects.toMatchObject({ status: 400 });
    expect(state.exceptions).toHaveLength(0);
  });
});

describe("goalkeeper bulk availability - identity boundary", () => {
  it("an eligible H goalkeeper bulk-updates their OWN fixtures (legitimate)", async () => {
    const out = await setMyAvailabilityForDate(ENV, { email: "gk-a@example.com", date: DATE_KEY, status: "Unavailable" });
    expect(out.success).toBe(true);
    expect(out.updated).toBe(3); // every HKFC fixture on the date
    expect(state.exceptions).toHaveLength(3);
    expect(state.exceptions.every((e) => e.fields["Player"]?.[0] === "recGKA")).toBe(true);
  });

  it("one goalkeeper's bulk update never touches another goalkeeper's exceptions", async () => {
    // KeeperB already has exceptions on the date's fixtures.
    state.exceptions = [
      exception("recEB1", "recGKB", "recM1", "Maybe"),
      exception("recEB2", "recGKB", "recM2", "Unavailable"),
    ];

    // KeeperA's session performs the bulk update for the date.
    await setMyAvailabilityForDate(ENV, { email: "gk-a@example.com", date: DATE_KEY, status: "Unavailable" });

    // KeeperB's exceptions are untouched.
    for (const id of ["recEB1", "recEB2"]) {
      const e = state.exceptions.find((x) => x.id === id);
      expect(e).toBeTruthy();
      expect(e.fields["Player"]).toEqual(["recGKB"]);
    }
    // KeeperA gets their own fresh exceptions for the same fixtures.
    const gkAExceptions = state.exceptions.filter((e) => e.fields["Player"]?.[0] === "recGKA");
    expect(gkAExceptions).toHaveLength(3);
  });

  it("bulk Available deletes only the caller's own exceptions", async () => {
    state.exceptions = [
      exception("recEB1", "recGKB", "recM1", "Maybe"),
      exception("recE_A1", "recGKA", "recM1", "Unavailable"),
    ];
    const out = await setMyAvailabilityForDate(ENV, { email: "gk-a@example.com", date: DATE_KEY, status: "Available" });
    expect(out.success).toBe(true);
    // KeeperA's exception deleted; KeeperB's untouched.
    expect(state.exceptions).toHaveLength(1);
    expect(state.exceptions[0].id).toBe("recEB1");
    expect(state.exceptions[0].fields["Player"]).toEqual(["recGKB"]);
    // No Available records were created.
    expect(state.exceptions.some((e) => e.fields["Availability Status"] === "Available")).toBe(false);
  });
});
