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
import { fakeAirtable, type FakeTables } from "./helpers/airtable";

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

function seed() {
  state = {
    people: PEOPLE.map((p) => ({ id: p.id, fields: { ...p.fields } })),
    teams: TEAMS.map((t) => ({ id: t.id, fields: { ...t.fields } })),
    matches: [match("recM1", "B"), match("recM2", "A"), match("recM3", "H")],
    exceptions: [],
  };
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
  // Getters, not a snapshot: some tests reassign state.exceptions etc.
  // directly, and the fake must see the live array.
  const tables: FakeTables = {
    get People() { return state.people; },
    get Teams() { return state.teams; },
    get Matches() { return state.matches; },
    get "Availability Exceptions"() { return state.exceptions; },
  };
  fakeAirtable(tables);
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
