import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Opt-In Only: a coach inverts one player's availability default.
//
// The club runs on opt-out - available unless you say otherwise - because
// nobody answers thirty fixtures individually. That breaks for the player who
// is out most of the season and never opens the app: they show Available on
// every coach sheet, which reads as an answer rather than as silence.
//
// The half of this that is easy to get wrong is the way OUT. "Available" has
// always been expressed by DELETING the exception, which only works while
// "no record" and "Available" mean the same thing. Under this flag they do
// not, so an Available answer has to be written down or the player can never
// opt in at all.
// ---------------------------------------------------------------------------

import { fakeAirtable, type FakeTables } from "./helpers/airtable";
import { invalidateAll } from "../worker/src/cache";
import { effectiveAvailability, needsExplicitAvailable } from "../worker/src/availabilityRules";
import { setAvailability, setPlayerOptInOnly } from "../worker/src/availability";
import { getPlayersForMatch } from "../worker/src/squad";
import type { AvailabilityRule } from "../shared/schema/domainTypes";

const ENV = {
  AIRTABLE_TOKEN: "***",
  AIRTABLE_BASE_ID: "appTest",
  CALENDAR_SECRET: "***",
  ALLOWED_ORIGIN: "https://app.test",
  SUPABASE_URL: "https://t.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

const FIXTURE = { date: "2026-10-10", isPlayUp: false, isSupport: false };

function rule(partial: Partial<AvailabilityRule>): AvailabilityRule {
  return {
    id: "recR1",
    player: ["recP1"],
    ruleType: "All future",
    availability: "Available",
    active: true,
    lastModified: "2026-09-01T00:00:00.000Z",
    ...partial,
  } as AvailabilityRule;
}

function tables(): FakeTables {
  return {
    Teams: [
      { id: "recTA", fields: { "Team Name": "A", "Team Rank": 1, Active: true, "Target Squad Size": 16 } },
      { id: "recTC", fields: { "Team Name": "C", "Team Rank": 3, Active: true, "Target Squad Size": 16 } },
    ],
    People: [
      // Rarely around, never updates anything - the player this is for.
      { id: "recGhost", fields: { "Preferred Name": "Ghost", Surname: "G", Email: "ghost@hkfc.com", Active: true, "Registered Team": "C", "Playing Position": "Forward", "Playing Ability": "D", Status: "Active", "Opt-In Only": true } },
      // Ordinary player on the club default.
      { id: "recReg", fields: { "Preferred Name": "Reg", Surname: "R", Email: "reg@hkfc.com", Active: true, "Registered Team": "C", "Playing Position": "Forward", "Playing Ability": "C", Status: "Active" } },
    ],
    Matches: [
      { id: "recM1", fields: { Date: "2026-10-10T09:00:00.000Z", Season: "2026-2027", "Home Team": "C", "Away Team": "Valley", "Match Status": "Scheduled", "Selected Players Home": [], "Selected Players Away": [] } },
    ],
    "Match Cards": [],
    "Availability Exceptions": [],
    "Availability Rules": [],
  };
}

let state: FakeTables;
beforeEach(() => {
  invalidateAll();
  state = tables();
  fakeAirtable(state);
});
afterEach(() => vi.unstubAllGlobals());

describe("resolution order", () => {
  it("makes an unanswered fixture Unavailable, and says it was not the player's doing", () => {
    const r = effectiveAvailability(null, [], FIXTURE, { optInOnly: true });
    expect(r.status).toBe("Unavailable");
    // fromRule drives the coach-facing distinction between "hasn't been
    // asked" and "said no". A default the player never chose is not an answer.
    expect(r.fromRule).toBe(true);
  });

  it("lets the player's own answer win, which is the entire point", () => {
    expect(effectiveAvailability("Available", [], FIXTURE, { optInOnly: true }).status).toBe("Available");
    expect(effectiveAvailability("Maybe", [], FIXTURE, { optInOnly: true }).status).toBe("Maybe");
  });

  // The flag exists because the player is NOT maintaining their status, so a
  // standing rule of theirs - especially one that just restates the club
  // default - must not be able to switch it back off.
  it("outranks the player's own standing rules", () => {
    const rules = [rule({ ruleType: "All future", availability: "Available" })];
    expect(effectiveAvailability(null, rules, FIXTURE, { optInOnly: true }).status).toBe("Unavailable");
    expect(effectiveAvailability(null, rules, FIXTURE, { optInOnly: false }).status).toBe("Available");
  });

  it("changes nothing for everyone else", () => {
    expect(effectiveAvailability(null, [], FIXTURE).status).toBe("Available");
    expect(effectiveAvailability(null, [], FIXTURE, { optInOnly: false }).status).toBe("Available");
  });
});

describe("an Available answer is stored only when something would contradict it", () => {
  it("knows when absence is no longer enough", () => {
    expect(needsExplicitAvailable([], FIXTURE)).toBe(false);
    expect(needsExplicitAvailable([], FIXTURE, { optInOnly: true })).toBe(true);
    expect(needsExplicitAvailable([rule({ availability: "Unavailable" })], FIXTURE)).toBe(true);
  });

  // The regression this whole feature turns on. Deleting the record hands the
  // fixture straight back to the default, so the player taps Available, the
  // screen does not move, and nothing explains why.
  it("writes a real record so an opt-in-only player can actually opt in", async () => {
    const result = await setAvailability(ENV, {
      playerId: "recGhost",
      matchIds: ["recM1"],
      status: "Available",
    });
    expect(result.results[0].exceptionId).toBeTruthy();
    const stored = state["Availability Exceptions"];
    expect(stored).toHaveLength(1);
    expect(stored[0].fields["Availability Status"]).toBe("Available");
  });

  it("still keeps the table sparse for a player on the normal default", async () => {
    const result = await setAvailability(ENV, {
      playerId: "recReg",
      matchIds: ["recM1"],
      status: "Available",
    });
    expect(result.results[0].exceptionId).toBeNull();
    expect(state["Availability Exceptions"]).toHaveLength(0);
  });

  it("removes a stored Available again once the flag is lifted", async () => {
    await setAvailability(ENV, { playerId: "recGhost", matchIds: ["recM1"], status: "Available" });
    expect(state["Availability Exceptions"]).toHaveLength(1);

    // "Season (Matches)" is a LOOKUP: Airtable fills it in from the linked
    // Match, so the write never sets it and the fake never computes it. The
    // read that finds this record again filters on that season, so without
    // this line the record is invisible to the second write and the test
    // fails for a reason that has nothing to do with the behaviour.
    state["Availability Exceptions"][0].fields["Season (Matches)"] = "2026-2027";

    invalidateAll();
    state.People[0].fields["Opt-In Only"] = false;
    await setAvailability(ENV, { playerId: "recGhost", matchIds: ["recM1"], status: "Available" });
    expect(state["Availability Exceptions"]).toHaveLength(0);
  });
});

describe("the coach toggle", () => {
  it("writes the People field and reports the new state", async () => {
    const res = await setPlayerOptInOnly(ENV, {
      coachEmail: "coach@hkfc.com",
      playerId: "recReg",
      optInOnly: true,
    });
    expect(res).toMatchObject({ success: true, playerId: "recReg", optInOnly: true });
    expect(state.People.find((p) => p.id === "recReg")!.fields["Opt-In Only"]).toBe(true);
  });

  it("rejects a non-boolean rather than writing something odd", async () => {
    await expect(
      setPlayerOptInOnly(ENV, { coachEmail: "c@hkfc.com", playerId: "recReg", optInOnly: "yes" as any }),
    ).rejects.toThrow(/must be a boolean/);
  });
});

describe("what the coach sees on the squad sheet", () => {
  it("shows the player Unavailable, flagged as a default rather than an answer", async () => {
    const { players } = await getPlayersForMatch(ENV, "recM1", "home");
    const ghost = players.find((p: any) => p.id === "recGhost");
    const reg = players.find((p: any) => p.id === "recReg");

    expect(ghost).toMatchObject({
      availabilityStatus: "Unavailable",
      availabilityFromRule: true,
      optInOnly: true,
    });
    expect(reg).toMatchObject({
      availabilityStatus: "Available",
      availabilityFromRule: false,
      optInOnly: false,
    });
  });
});
