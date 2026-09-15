import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
import { fakeAirtable, type FakeTables } from "./helpers/airtable";

const ENV = {
  AIRTABLE_TOKEN: "***",
  AIRTABLE_BASE_ID: "test-base",
  CALENDAR_SECRET: "***",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

const DATE_KEY = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0];

const TEAMS = [{ id: "recT0", fields: { "Team Name": "B", "Team Rank": 2, Active: true } }];

const PEOPLE = [
  { id: "recCoach", fields: { "Preferred Name": "Cathy", Email: "coach@example.com", Active: true, "Registered Team": "B" } },
  { id: "recA", fields: { "Preferred Name": "Alice", Email: "alice@example.com", Active: true, "Registered Team": "B" } },
  { id: "recGone", fields: { "Preferred Name": "Gone", Email: "gone@example.com", Active: false, "Registered Team": "B" } },
];

let state: { people: any[]; teams: any[]; matches: any[]; exceptions: any[] };

function exception(id: string, playerId: string, matchId: string, status = "Unavailable"): any {
  return {
    id,
    fields: { Player: [playerId], Match: [matchId], "Availability Status": status, "Player Notes": "", "Season (Matches)": "2026-2027" },
  };
}

beforeEach(() => {
  invalidateAll();
  state = {
    people: PEOPLE.map((p) => ({ id: p.id, fields: { ...p.fields } })),
    teams: TEAMS.map((t) => ({ id: t.id, fields: { ...t.fields } })),
    matches: [
      { id: "recM1", fields: { Date: `${DATE_KEY}T09:00:00.000Z`, Season: "2026-2027", "Home Team": "B", "Away Team": "Valley", "Match Status": "Scheduled" } },
    ],
    exceptions: [],
  };
  const tables: FakeTables = {
    get People() { return state.people; },
    get Teams() { return state.teams; },
    get Matches() { return state.matches; },
    get "Availability Exceptions"() { return state.exceptions; },
  };
  fakeAirtable(tables);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("setPlayerAvailability", () => {
  it("writes the player's exception with the coach as the author", async () => {
    const out = await setPlayerAvailability(ENV, {
      coachPersonId: "recCoach",
      playerId: "recA",
      matchId: "recM1",
      status: "Unavailable",
      notes: "Texted me - away that weekend",
    });
    expect(out.success).toBe(true);
    expect(out.exceptionId).toBeTruthy();
    expect(state.exceptions).toHaveLength(1);
    const fields = state.exceptions[0].fields;
    expect(fields["Player"]).toEqual(["recA"]);
    expect(fields["Match"]).toEqual(["recM1"]);
    expect(fields["Availability Status"]).toBe("Unavailable");
    expect(fields["Player Notes"]).toBe("Texted me - away that weekend");
    // The record says who actually spoke.
    expect(fields["Updated By"]).toEqual(["recCoach"]);
  });

  it("updates the player's existing answer rather than adding a second one", async () => {
    state.exceptions = [exception("recX1", "recA", "recM1", "Maybe")];
    const out = await setPlayerAvailability(ENV, {
      coachPersonId: "recCoach",
      playerId: "recA",
      matchId: "recM1",
      status: "Unavailable",
    });
    expect(out.exceptionId).toBe("recX1");
    expect(state.exceptions).toHaveLength(1);
    expect(state.exceptions[0].fields["Availability Status"]).toBe("Unavailable");
    expect(state.exceptions[0].fields["Updated By"]).toEqual(["recCoach"]);
  });

  it("Available clears the player's answer, exactly as their own tap would", async () => {
    state.exceptions = [exception("recX1", "recA", "recM1", "Unavailable")];
    const out = await setPlayerAvailability(ENV, {
      coachPersonId: "recCoach",
      playerId: "recA",
      matchId: "recM1",
      status: "Available",
    });
    expect(out.exceptionId).toBeNull();
    expect(state.exceptions).toHaveLength(0);
  });

  it("refuses to answer for an inactive player", async () => {
    await expect(
      setPlayerAvailability(ENV, { coachPersonId: "recCoach", playerId: "recGone", matchId: "recM1", status: "Maybe" }),
    ).rejects.toMatchObject({ status: 404 });
    expect(state.exceptions).toHaveLength(0);
  });

  it("rejects a status outside the exception model", async () => {
    await expect(
      setPlayerAvailability(ENV, { coachPersonId: "recCoach", playerId: "recA", matchId: "recM1", status: "Yes" as any }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("needs a coach identity, a player and a match", async () => {
    await expect(
      setPlayerAvailability(ENV, { coachPersonId: "", playerId: "recA", matchId: "recM1", status: "Maybe" }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      setPlayerAvailability(ENV, { coachPersonId: "recCoach", playerId: "", matchId: "recM1", status: "Maybe" }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      setPlayerAvailability(ENV, { coachPersonId: "recCoach", playerId: "recA", matchId: "", status: "Maybe" }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
