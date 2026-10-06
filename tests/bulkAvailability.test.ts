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
import { useFakeRepos } from "./helpers/fakeRepos";
import { fakePostgrest, SUPABASE_TEST_ENV } from "./helpers/postgrest";
import { exception, match, person, recId, team } from "./helpers/factories";

const ENV = {
  ...SUPABASE_TEST_ENV,
  CALENDAR_SECRET: "***",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

/** Date-rot-proof: a fixed date key 7 days out. */
const DATE_KEY = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0];

const GK = recId("GK");
const M1 = recId("M1");
const M2 = recId("M2");
const M3 = recId("M3");

function fixture(id: string, homeTeam: string, hkfc = true) {
  return match({
    id,
    matchDate: `${DATE_KEY}T09:00:00.000Z`,
    season: "2026-2027",
    homeTeam,
    awayTeam: hkfc ? "B" : "Valley",
    matchStatus: "Scheduled",
  });
}

const db = useFakeRepos(() => ({
  people: [
    person({ id: GK, preferredName: "Bob", email: "gk@hkfc.com", active: true, registeredTeam: "H", playingPosition: "Goalkeeper" }),
    person({ id: recId("OUT"), preferredName: "Dave", email: "dave@hkfc.com", active: true, registeredTeam: "A", playingPosition: "Defender" }),
  ],
  teams: ["A", "B", "H"].map((n, i) => team({ id: recId(`T${i}`), teamName: n, teamRank: n === "A" ? 1 : n === "B" ? 2 : 8, active: true })),
  matches: [
    fixture(M1, "A"), // HKFC fixture on the date
    fixture(M2, "H"), // second HKFC fixture on the date
    // no HKFC side
    match({ id: M3, matchDate: `${DATE_KEY}T15:00:00.000Z`, season: "2026-2027", homeTeam: "Valley X", awayTeam: "Valley Y", matchStatus: "Scheduled" }),
  ],
}));

const stored = () => db.state.availabilityExceptions;

beforeEach(() => {
  invalidateAll();
  // Nothing here should reach Supabase directly; any request fails the test.
  fakePostgrest({ tables: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("setMyAvailabilityForDate", () => {
  it("bulk Unavailable creates one exception per HKFC fixture on the date", async () => {
    const out = await setMyAvailabilityForDate(ENV, { email: "gk@hkfc.com", date: DATE_KEY, status: "Unavailable" });
    expect(out.success).toBe(true);
    expect(out.updated).toBe(2); // M1 + M2; the no-HKFC-side match is excluded
    expect(out.results.map((r) => r.matchId).sort()).toEqual([M1, M2].sort());
    expect(out.results.every((r) => r.exceptionId)).toBe(true);
    expect(stored()).toHaveLength(2);
    expect(stored().every((e) => e.availabilityStatus === "Unavailable")).toBe(true);
  });

  it("bulk Maybe upserts exceptions for the date", async () => {
    await setMyAvailabilityForDate(ENV, { email: "gk@hkfc.com", date: DATE_KEY, status: "Maybe" });
    expect(stored()).toHaveLength(2);
    expect(stored().every((e) => e.availabilityStatus === "Maybe")).toBe(true);
  });

  it("bulk Available deletes existing exceptions and creates NO Available records", async () => {
    // Pre-existing Maybe + Unavailable exceptions on the date's fixtures.
    db.state.availabilityExceptions.push(
      exception({ id: recId("E1"), player: [GK], match: [M1], availabilityStatus: "Maybe", season: "2026-2027" }),
      exception({ id: recId("E2"), player: [GK], match: [M2], availabilityStatus: "Unavailable", season: "2026-2027" }),
    );
    const out = await setMyAvailabilityForDate(ENV, { email: "gk@hkfc.com", date: DATE_KEY, status: "Available" });
    expect(out.updated).toBe(2);
    expect(out.results.every((r) => r.exceptionId === null)).toBe(true);
    // Both exceptions deleted; nothing re-created.
    expect(stored()).toHaveLength(0);
  });

  it("individual fixtures remain overridable after a bulk update", async () => {
    await setMyAvailabilityForDate(ENV, { email: "gk@hkfc.com", date: DATE_KEY, status: "Available" });
    expect(stored()).toHaveLength(0);

    // Override one fixture to Unavailable via the existing single-fixture path.
    const out = await setMyAvailability(ENV, { email: "gk@hkfc.com", matchId: M2, status: "Unavailable", notes: "Work" });
    expect(out.exceptionId).toBeTruthy();
    expect(stored()).toHaveLength(1);
    expect(stored()[0].match).toEqual([M2]);
    expect(stored()[0].availabilityStatus).toBe("Unavailable");
  });

  it("excludes matches with no HKFC side and returns 0 updates when nothing matches", async () => {
    const out = await setMyAvailabilityForDate(ENV, { email: "gk@hkfc.com", date: "2030-01-01", status: "Unavailable" });
    expect(out.success).toBe(true);
    expect(out.updated).toBe(0);
    expect(stored()).toHaveLength(0);
  });

  // Date-level availability used to be restricted to the goalkeeper cohort.
  // It is now open to every authorized player: "I'm away this Saturday" is
  // the most common thing a player needs to say, and it should not take one
  // tap per fixture.
  it("allows an outfield player to clear a whole date", async () => {
    const out = await setMyAvailabilityForDate(ENV, { email: "dave@hkfc.com", date: DATE_KEY, status: "Unavailable" });
    expect(out.success).toBe(true);
    expect(out.updated).toBe(2); // M1 + M2; the no-HKFC-side match is excluded
    expect(stored()).toHaveLength(2);
    expect(stored().every((e) => e.availabilityStatus === "Unavailable")).toBe(true);
  });

  it("still refuses an email with no People record", async () => {
    await expect(
      setMyAvailabilityForDate(ENV, { email: "nobody@example.com", date: DATE_KEY, status: "Unavailable" }),
    ).rejects.toMatchObject({ status: 404 });
    expect(stored()).toHaveLength(0);
  });

  it("rejects malformed dates", async () => {
    await expect(
      setMyAvailabilityForDate(ENV, { email: "gk@hkfc.com", date: "31-12-2026", status: "Unavailable" }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
