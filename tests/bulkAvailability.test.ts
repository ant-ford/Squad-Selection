import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Date-level bulk availability (special goalkeeper view UX shortcut)
// worker/src/availability.ts :: setMyAvailabilityForDate
//
// The bulk control performs the existing match-level updates for every HKFC
// fixture on one date. "Available" deletes exceptions (no Available records
// are ever created); Maybe/Unavailable upsert. Individual fixtures stay
// independently overridable afterwards.
// ---------------------------------------------------------------------------

import { setMyAvailabilityForDate, setMyAvailability } from "../worker/src/availability";
import { invalidateAll } from "../worker/src/cache";
import { fakeAirtable, type FakeTables } from "./helpers/airtable";

const ENV = {
  AIRTABLE_TOKEN: "***",
  AIRTABLE_BASE_ID: "test-base",
  CALENDAR_SECRET: "***",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

/** Date-rot-proof: a fixed date key 7 days out. */
const DATE_KEY = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0];

const TEAMS = ["A", "B", "H"].map((n, i) => ({
  id: `recT${i}`,
  fields: { "Team Name": n, "Team Rank": n === "A" ? 1 : n === "B" ? 2 : 8, Active: true },
}));

const PEOPLE = [
  {
    id: "recGK",
    fields: {
      "Preferred Name": "Bob",
      Email: "gk@hkfc.com",
      Active: true,
      "Registered Team": "H",
      "Playing Position": "Goalkeeper",
    },
  },
  {
    id: "recOUT",
    fields: {
      "Preferred Name": "Dave",
      Email: "dave@hkfc.com",
      Active: true,
      "Registered Team": "A",
      "Playing Position": "Defender",
    },
  },
];

function match(id: string, homeTeam: string, hkfc = true): any {
  return {
    id,
    fields: {
      Date: `${DATE_KEY}T09:00:00.000Z`,
      Season: "2026-2027",
      "Home Team": homeTeam,
      "Away Team": hkfc ? "B" : "Valley",
      "Match Status": "Scheduled",
    },
  };
}

let state: { people: any[]; teams: any[]; matches: any[]; exceptions: any[] };

function seed() {
  state = {
    people: PEOPLE.map((p) => ({ id: p.id, fields: { ...p.fields } })),
    teams: TEAMS.map((t) => ({ id: t.id, fields: { ...t.fields } })),
    matches: [
      match("recM1", "A"), // HKFC fixture on the date
      match("recM2", "H"), // second HKFC fixture on the date
      { id: "recM3", fields: { Date: `${DATE_KEY}T15:00:00.000Z`, Season: "2026-2027", "Home Team": "Valley X", "Away Team": "Valley Y", "Match Status": "Scheduled" } }, // no HKFC side
    ],
    exceptions: [],
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

const tick = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => {
  invalidateAll();
  seed();
  installFakeAirtable();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("setMyAvailabilityForDate", () => {
  it("bulk Unavailable creates one exception per HKFC fixture on the date", async () => {
    const out = await setMyAvailabilityForDate(ENV, { email: "gk@hkfc.com", date: DATE_KEY, status: "Unavailable" });
    expect(out.success).toBe(true);
    expect(out.updated).toBe(2); // recM1 + recM2; the no-HKFC-side match is excluded
    expect(out.results.map((r) => r.matchId).sort()).toEqual(["recM1", "recM2"]);
    expect(out.results.every((r) => r.exceptionId)).toBe(true);
    expect(state.exceptions).toHaveLength(2);
    expect(state.exceptions.every((e) => e.fields["Availability Status"] === "Unavailable")).toBe(true);
  });

  it("bulk Maybe upserts exceptions for the date", async () => {
    await setMyAvailabilityForDate(ENV, { email: "gk@hkfc.com", date: DATE_KEY, status: "Maybe" });
    expect(state.exceptions).toHaveLength(2);
    expect(state.exceptions.every((e) => e.fields["Availability Status"] === "Maybe")).toBe(true);
  });

  it("bulk Available deletes existing exceptions and creates NO Available records", async () => {
    // Pre-existing Maybe + Unavailable exceptions on the date's fixtures.
    state.exceptions = [
      { id: "recE1", fields: { Player: ["recGK"], Match: ["recM1"], "Availability Status": "Maybe", "Season (Matches)": "2026-2027" } },
      { id: "recE2", fields: { Player: ["recGK"], Match: ["recM2"], "Availability Status": "Unavailable", "Season (Matches)": "2026-2027" } },
    ];
    const out = await setMyAvailabilityForDate(ENV, { email: "gk@hkfc.com", date: DATE_KEY, status: "Available" });
    expect(out.updated).toBe(2);
    expect(out.results.every((r) => r.exceptionId === null)).toBe(true);
    // Both exceptions deleted; nothing re-created.
    expect(state.exceptions).toHaveLength(0);
  });

  it("individual fixtures remain overridable after a bulk update", async () => {
    await setMyAvailabilityForDate(ENV, { email: "gk@hkfc.com", date: DATE_KEY, status: "Available" });
    expect(state.exceptions).toHaveLength(0);

    // Override one fixture to Unavailable via the existing single-fixture path.
    const out = await setMyAvailability(ENV, { email: "gk@hkfc.com", matchId: "recM2", status: "Unavailable", notes: "Work" });
    expect(out.exceptionId).toBeTruthy();
    expect(state.exceptions).toHaveLength(1);
    expect(state.exceptions[0].fields["Match"]).toEqual(["recM2"]);
    expect(state.exceptions[0].fields["Availability Status"]).toBe("Unavailable");
  });

  it("excludes matches with no HKFC side and returns 0 updates when nothing matches", async () => {
    const out = await setMyAvailabilityForDate(ENV, { email: "gk@hkfc.com", date: "2030-01-01", status: "Unavailable" });
    expect(out.success).toBe(true);
    expect(out.updated).toBe(0);
    expect(state.exceptions).toHaveLength(0);
  });

  // Date-level availability used to be restricted to the goalkeeper cohort.
  // It is now open to every authorized player: "I'm away this Saturday" is
  // the most common thing a player needs to say, and it should not take one
  // tap per fixture.
  it("allows an outfield player to clear a whole date", async () => {
    const out = await setMyAvailabilityForDate(ENV, { email: "dave@hkfc.com", date: DATE_KEY, status: "Unavailable" });
    expect(out.success).toBe(true);
    expect(out.updated).toBe(2); // recM1 + recM2; the no-HKFC-side match is excluded
    expect(state.exceptions).toHaveLength(2);
    expect(state.exceptions.every((e) => e.fields["Availability Status"] === "Unavailable")).toBe(true);
  });

  it("still refuses an email with no People record", async () => {
    await expect(
      setMyAvailabilityForDate(ENV, { email: "nobody@example.com", date: DATE_KEY, status: "Unavailable" }),
    ).rejects.toMatchObject({ status: 404 });
    expect(state.exceptions).toHaveLength(0);
  });

  it("rejects malformed dates", async () => {
    await expect(
      setMyAvailabilityForDate(ENV, { email: "gk@hkfc.com", date: "31-12-2026", status: "Unavailable" }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
