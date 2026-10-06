import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Availability security - cross-player (IDOR) regression tests
//
// Identity for player self-service availability comes ONLY from the verified
// Supabase session (the router derives the email; these tests exercise the
// Worker functions with that session-derived identity). Prove that:
//   - a player can update their OWN availability,
//   - an exception record ID alone can NEVER modify or delete another
//     player's exception,
//   - the goalkeeper date-level bulk affects only the authenticated keeper's
//     fixtures,
//   - the exception model invariants hold (Available deletes; no Available
//     records; Maybe/Unavailable upsert).
// ---------------------------------------------------------------------------

import { setMyAvailability, setMyAvailabilityForDate } from "../worker/src/availability";
import { invalidateAll } from "../worker/src/cache";
import { useFakeRepos } from "./helpers/fakeRepos";
import { fakePostgrest, SUPABASE_TEST_ENV } from "./helpers/postgrest";
import { exception as exceptionRow, match, person, recId, team } from "./helpers/factories";

const ENV = {
  ...SUPABASE_TEST_ENV,
  CALENDAR_SECRET: "***",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

const DATE_KEY = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0];

const A = recId("A");
const B = recId("B");
const GKA = recId("GKA");
const GKB = recId("GKB");
const M1 = recId("M1");
const M2 = recId("M2");
const M3 = recId("M3");
const EB1 = recId("EB1");
const EB2 = recId("EB2");

function fixture(id: string, homeTeam: string, date = DATE_KEY) {
  return match({
    id,
    matchDate: `${date}T09:00:00.000Z`,
    season: "2026-2027",
    homeTeam,
    awayTeam: "B",
    matchStatus: "Scheduled",
  });
}

function exception(id: string, playerId: string, matchId: string, status = "Unavailable") {
  return exceptionRow({ id, player: [playerId], match: [matchId], availabilityStatus: status, note: "", season: "2026-2027" });
}

const db = useFakeRepos(() => ({
  people: [
    person({ id: A, preferredName: "Alice", email: "player-a@example.com", active: true, registeredTeam: "B", playingPosition: "Defender" }),
    person({ id: B, preferredName: "Bill", email: "player-b@example.com", active: true, registeredTeam: "B", playingPosition: "Forward" }),
    person({ id: GKA, preferredName: "KeeperA", email: "gk-a@example.com", active: true, registeredTeam: "H", playingPosition: "Goalkeeper" }),
    person({ id: GKB, preferredName: "KeeperB", email: "gk-b@example.com", active: true, registeredTeam: "H", playingPosition: "Goalkeeper" }),
  ],
  teams: ["A", "B", "H"].map((n, i) => team({ id: recId(`T${i}`), teamName: n, teamRank: n === "A" ? 1 : n === "B" ? 2 : 8, active: true })),
  matches: [fixture(M1, "B"), fixture(M2, "A"), fixture(M3, "H")],
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

describe("normal availability - identity boundary", () => {
  it("a player updates their OWN availability (legitimate)", async () => {
    const out = await setMyAvailability(ENV, {
      email: "player-a@example.com",
      matchId: M1,
      status: "Unavailable",
      notes: "Away",
    });
    expect(out.success).toBe(true);
    expect(out.exceptionId).toBeTruthy();
    expect(stored()).toHaveLength(1);
    expect(stored()[0].player).toEqual([A]); // Alice's own record
    expect(stored()[0].availabilityStatus).toBe("Unavailable");
  });

  it("updating the same match never touches another player's exception (modify)", async () => {
    // Bill already has an Unavailable exception on M1. The Worker now
    // resolves the caller's own exception itself (no client-supplied record
    // ID exists in the request shape any more), so there is no longer a
    // parameter through which Bill's ID could even be offered.
    stored().push(exception(EB1, B, M1));

    const out = await setMyAvailability(ENV, {
      email: "player-a@example.com",
      matchId: M1,
      status: "Unavailable",
    });

    // Bill's exception is untouched.
    const billException = stored().find((e) => e.id === EB1);
    expect(billException).toBeTruthy();
    expect(billException!.player).toEqual([B]);
    expect(billException!.availabilityStatus).toBe("Unavailable");
    // Alice gets her OWN exception instead.
    expect(out.exceptionId).not.toBe(EB1);
    const aliceException = stored().find((e) => e.player?.[0] === A);
    expect(aliceException).toBeTruthy();
  });

  it("updating the same match never touches another player's exception (delete)", async () => {
    stored().push(exception(EB1, B, M1, "Unavailable"));

    // Unavailable -> Available deletes the CALLER's exception only.
    const out = await setMyAvailability(ENV, {
      email: "player-a@example.com",
      matchId: M1,
      status: "Available",
    });

    expect(out.exceptionId).toBeNull();
    // Bill's exception still exists (not deleted).
    expect(stored()).toHaveLength(1);
    expect(stored()[0].id).toBe(EB1);
    expect(stored()[0].player).toEqual([B]);
  });

  it("rejects forged statuses that would corrupt the exception model", async () => {
    await expect(
      setMyAvailability(ENV, { email: "player-a@example.com", matchId: M1, status: "Selected" as any }),
    ).rejects.toMatchObject({ status: 400 });
    expect(stored()).toHaveLength(0);
  });
});

describe("goalkeeper bulk availability - identity boundary", () => {
  it("an eligible H goalkeeper bulk-updates their OWN fixtures (legitimate)", async () => {
    const out = await setMyAvailabilityForDate(ENV, { email: "gk-a@example.com", date: DATE_KEY, status: "Unavailable" });
    expect(out.success).toBe(true);
    expect(out.updated).toBe(3); // every HKFC fixture on the date
    expect(stored()).toHaveLength(3);
    expect(stored().every((e) => e.player?.[0] === GKA)).toBe(true);
  });

  it("one goalkeeper's bulk update never touches another goalkeeper's exceptions", async () => {
    // KeeperB already has exceptions on the date's fixtures.
    stored().push(exception(EB1, GKB, M1, "Maybe"), exception(EB2, GKB, M2, "Unavailable"));

    // KeeperA's session performs the bulk update for the date.
    await setMyAvailabilityForDate(ENV, { email: "gk-a@example.com", date: DATE_KEY, status: "Unavailable" });

    // KeeperB's exceptions are untouched.
    for (const id of [EB1, EB2]) {
      const e = stored().find((x) => x.id === id);
      expect(e).toBeTruthy();
      expect(e!.player).toEqual([GKB]);
    }
    // KeeperA gets their own fresh exceptions for the same fixtures.
    const gkAExceptions = stored().filter((e) => e.player?.[0] === GKA);
    expect(gkAExceptions).toHaveLength(3);
  });

  it("bulk Available deletes only the caller's own exceptions", async () => {
    stored().push(exception(EB1, GKB, M1, "Maybe"), exception(recId("EA1"), GKA, M1, "Unavailable"));
    const out = await setMyAvailabilityForDate(ENV, { email: "gk-a@example.com", date: DATE_KEY, status: "Available" });
    expect(out.success).toBe(true);
    // KeeperA's exception deleted; KeeperB's untouched.
    expect(stored()).toHaveLength(1);
    expect(stored()[0].id).toBe(EB1);
    expect(stored()[0].player).toEqual([GKB]);
    // No Available records were created.
    expect(stored().some((e) => e.availabilityStatus === "Available")).toBe(false);
  });
});
