import { describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// A coach answering for a player (worker/src/availability.ts ::
// setPlayerAvailability).
//
// Players who cannot get into the app still tell their coach whether they
// can play. This is the same write as the player's own tap - so every view
// built on Availability Exceptions moves together - with the coach, not the
// player, recorded as the author of the change.
// ---------------------------------------------------------------------------

import { setPlayerAvailability } from "../worker/src/availability";
import { invalidateAll } from "../worker/src/cache";
import type { Env } from "../worker/src/env";
import { useFakeRepos } from "./helpers/fakeRepos";
import { exception, match, person, recId, team } from "./helpers/factories";

const ENV = {} as Env;

const DATE_KEY = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0];

const COACH = recId("Coach");
const ALICE = recId("Alice");
const GONE = recId("Gone");
const M1 = recId("M1");

const db = useFakeRepos(() => ({
  teams: [team({ id: recId("T0"), teamName: "B", teamRank: 2 })],
  people: [
    person({ id: COACH, preferredName: "Cathy", email: "coach@example.com", registeredTeam: "B" }),
    person({ id: ALICE, preferredName: "Alice", email: "alice@example.com", registeredTeam: "B" }),
    person({ id: GONE, preferredName: "Gone", email: "gone@example.com", active: false, registeredTeam: "B" }),
  ],
  matches: [match({ id: M1, matchDate: `${DATE_KEY}T09:00:00.000Z`, season: "2026-2027", homeTeam: "B", awayTeam: "Valley" })],
}));

const answer = (id: string, status = "Unavailable") =>
  exception({ id, player: [ALICE], match: [M1], availabilityStatus: status, season: "2026-2027" });

beforeEach(() => {
  invalidateAll();
});

describe("setPlayerAvailability", () => {
  it("writes the player's exception with the coach as the author", async () => {
    const out = await setPlayerAvailability(ENV, {
      coachPersonId: COACH,
      playerId: ALICE,
      matchId: M1,
      status: "Unavailable",
      notes: "Texted me - away that weekend",
    });
    expect(out.success).toBe(true);
    expect(out.exceptionId).toBeTruthy();
    expect(db.state.availabilityExceptions).toHaveLength(1);
    const row = db.state.availabilityExceptions[0];
    expect(row.player).toEqual([ALICE]);
    expect(row.match).toEqual([M1]);
    expect(row.availabilityStatus).toBe("Unavailable");
    expect(row.note).toBe("Texted me - away that weekend");
    // The record says who actually spoke.
    expect(row.updatedBy).toBe(COACH);
  });

  it("updates the player's existing answer rather than adding a second one", async () => {
    db.state.availabilityExceptions.push(answer(recId("X1"), "Maybe"));
    const out = await setPlayerAvailability(ENV, {
      coachPersonId: COACH,
      playerId: ALICE,
      matchId: M1,
      status: "Unavailable",
    });
    expect(out.exceptionId).toBe(recId("X1"));
    expect(db.state.availabilityExceptions).toHaveLength(1);
    expect(db.state.availabilityExceptions[0].availabilityStatus).toBe("Unavailable");
    expect(db.state.availabilityExceptions[0].updatedBy).toBe(COACH);
  });

  it("Available clears the player's answer, exactly as their own tap would", async () => {
    db.state.availabilityExceptions.push(answer(recId("X1"), "Unavailable"));
    const out = await setPlayerAvailability(ENV, {
      coachPersonId: COACH,
      playerId: ALICE,
      matchId: M1,
      status: "Available",
    });
    expect(out.exceptionId).toBeNull();
    expect(db.state.availabilityExceptions).toHaveLength(0);
  });

  it("refuses to answer for an inactive player", async () => {
    await expect(
      setPlayerAvailability(ENV, { coachPersonId: COACH, playerId: GONE, matchId: M1, status: "Maybe" }),
    ).rejects.toMatchObject({ status: 404 });
    expect(db.state.availabilityExceptions).toHaveLength(0);
  });

  it("rejects a status outside the exception model", async () => {
    await expect(
      setPlayerAvailability(ENV, { coachPersonId: COACH, playerId: ALICE, matchId: M1, status: "Yes" as any }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("needs a coach identity, a player and a match", async () => {
    await expect(
      setPlayerAvailability(ENV, { coachPersonId: "", playerId: ALICE, matchId: M1, status: "Maybe" }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      setPlayerAvailability(ENV, { coachPersonId: COACH, playerId: "", matchId: M1, status: "Maybe" }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      setPlayerAvailability(ENV, { coachPersonId: COACH, playerId: ALICE, matchId: "", status: "Maybe" }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
