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

import { invalidateAll } from "../worker/src/cache";
import { effectiveAvailability, needsExplicitAvailable } from "../worker/src/availabilityRules";
import { setAvailability, setPlayerOptInOnly } from "../worker/src/availability";
import { getPlayersForMatch } from "../worker/src/squad";
import type { AvailabilityRule } from "../shared/schema/domainTypes";
import { useFakeRepos } from "./helpers/fakeRepos";
import { fakePostgrest, SUPABASE_TEST_ENV } from "./helpers/postgrest";
import { match, person, recId, team } from "./helpers/factories";

const ENV = {
  ...SUPABASE_TEST_ENV,
  CALENDAR_SECRET: "***",
  ALLOWED_ORIGIN: "https://app.test",
  SUPABASE_URL: "https://t.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

const FIXTURE = { date: "2026-10-10", isPlayUp: false, isSupport: false };

const GHOST = recId("Ghost");
const REG = recId("Reg");
const M1 = recId("M1");

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

const db = useFakeRepos(() => ({
  teams: [
    team({ id: recId("TA"), teamName: "A", teamRank: 1, active: true, targetSquadSize: 16 }),
    team({ id: recId("TC"), teamName: "C", teamRank: 3, active: true, targetSquadSize: 16 }),
  ],
  people: [
    // Rarely around, never updates anything - the player this is for.
    person({
      id: GHOST, preferredName: "Ghost", surname: "G", email: "ghost@hkfc.com", active: true, registeredTeam: "C",
      playingPosition: "Forward", playingAbility: "D", status: "Active", optInOnly: true,
    }),
    // Ordinary player on the club default.
    person({
      id: REG, preferredName: "Reg", surname: "R", email: "reg@hkfc.com", active: true, registeredTeam: "C",
      playingPosition: "Forward", playingAbility: "C", status: "Active",
    }),
  ],
  matches: [
    match({
      id: M1, matchDate: "2026-10-10T09:00:00.000Z", season: "2026-2027", homeTeam: "C", awayTeam: "Valley",
      matchStatus: "Scheduled", selectedPlayersHome: [], selectedPlayersAway: [],
    }),
  ],
  matchCards: [],
  availabilityExceptions: [],
  availabilityRules: [],
}));

const stored = () => db.state.availabilityExceptions;

beforeEach(() => {
  invalidateAll();
  // Nothing here should reach Supabase directly; any request fails the test.
  fakePostgrest({ tables: {} });
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
      playerId: GHOST,
      matchIds: [M1],
      status: "Available",
    });
    expect(result.results[0].exceptionId).toBeTruthy();
    expect(stored()).toHaveLength(1);
    expect(stored()[0].availabilityStatus).toBe("Available");
  });

  it("still keeps the table sparse for a player on the normal default", async () => {
    const result = await setAvailability(ENV, {
      playerId: REG,
      matchIds: [M1],
      status: "Available",
    });
    expect(result.results[0].exceptionId).toBeNull();
    expect(stored()).toHaveLength(0);
  });

  it("removes a stored Available again once the flag is lifted", async () => {
    await setAvailability(ENV, { playerId: GHOST, matchIds: [M1], status: "Available" });
    expect(stored()).toHaveLength(1);
    // (On Supabase the exception's season comes from its match, as the
    // read that finds it again expects. The Airtable version had to set
    // the "Season (Matches)" lookup by hand here.)

    invalidateAll();
    db.state.people.find((p) => p.id === GHOST)!.optInOnly = false;
    await setAvailability(ENV, { playerId: GHOST, matchIds: [M1], status: "Available" });
    expect(stored()).toHaveLength(0);
  });
});

describe("the coach toggle", () => {
  it("writes the People field and reports the new state", async () => {
    const res = await setPlayerOptInOnly(ENV, {
      coachEmail: "coach@hkfc.com",
      playerId: REG,
      optInOnly: true,
    });
    expect(res).toMatchObject({ success: true, playerId: REG, optInOnly: true });
    expect(db.state.people.find((p) => p.id === REG)!.optInOnly).toBe(true);
  });

  // Coaches act only on their own teams (owner decision, 7 Oct 2026): the
  // route hands over who may be changed, and a refusal writes nothing.
  it("refuses a coach of another team with NOT_YOUR_TEAM, and writes nothing", async () => {
    const seen: string[] = [];
    await expect(
      setPlayerOptInOnly(ENV, {
        coachEmail: "coach@hkfc.com", playerId: REG, optInOnly: true,
        mayChange: (p) => { seen.push(p.registeredTeam ?? ""); return false; },
      }),
    ).rejects.toMatchObject({ status: 403, code: "NOT_YOUR_TEAM" });
    expect(seen).toEqual(["C"]);
    expect(db.state.people.find((p) => p.id === REG)!.optInOnly).toBeFalsy();

    await setPlayerOptInOnly(ENV, { coachEmail: "coach@hkfc.com", playerId: REG, optInOnly: true, mayChange: () => true });
    expect(db.state.people.find((p) => p.id === REG)!.optInOnly).toBe(true);
  });

  it("rejects a non-boolean rather than writing something odd", async () => {
    await expect(
      setPlayerOptInOnly(ENV, { coachEmail: "c@hkfc.com", playerId: REG, optInOnly: "yes" as any }),
    ).rejects.toThrow(/must be a boolean/);
  });
});

describe("what the coach sees on the squad sheet", () => {
  it("shows the player Unavailable, flagged as a default rather than an answer", async () => {
    const { players } = await getPlayersForMatch(ENV, M1, "home");
    const ghost = players.find((p: any) => p.id === GHOST);
    const reg = players.find((p: any) => p.id === REG);

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
