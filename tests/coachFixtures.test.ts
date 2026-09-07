import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Coach Dashboard fixture tiles: Maybe/Unavailable counts and name lists only
// consider players whose SELECTED (display) team is the fixture's team.
// Cross-team eligible players' marks belong to their own team's tile.
// The recommendation/selection engine is not involved in these counts.
// ---------------------------------------------------------------------------

import { getUpcomingFixtures } from "../worker/src/fixtures";
import { invalidateAll } from "../worker/src/cache";
import { fakeAirtable, type FakeTables } from "./helpers/airtable";

const ENV = {
  AIRTABLE_TOKEN: "***",
  AIRTABLE_BASE_ID: "test-base",
  CALENDAR_SECRET: "***",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

const DAY1 = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0];

const TEAMS = ["A", "B", "C", "D", "E", "F"].map((n, i) => ({
  id: `recT${i}`,
  fields: { "Team Name": n, "Team Rank": i + 1, Active: true },
}));

// Jonny: registered F but Selected Team EOS = E -> displayed as an E player.
// Tom:   registered E -> displayed as an E player.
// Harry: registered F -> displayed as an F player.
const PEOPLE = [
  { id: "recA", fields: { "Preferred Name": "Jonny", Email: "a@hkfc.com", Active: true, "Registered Team": "F", "Selected Team EOS": "E", "Playing Position": "Forward", "Playing Ability": "A" } },
  { id: "recB", fields: { "Preferred Name": "Tom", Email: "b@hkfc.com", Active: true, "Registered Team": "E", "Playing Position": "Midfielder", "Playing Ability": "B" } },
  { id: "recC", fields: { "Preferred Name": "Harry", Email: "c@hkfc.com", Active: true, "Registered Team": "F", "Playing Position": "Defender", "Playing Ability": "B" } },
];

let state: { people: any[]; teams: any[]; matches: any[]; exceptions: any[] };

function seed() {
  state = {
    people: PEOPLE.map((p) => ({ id: p.id, fields: { ...p.fields } })),
    teams: TEAMS.map((t) => ({ id: t.id, fields: { ...t.fields } })),
    matches: [
      { id: "recM_E", fields: { Date: `${DAY1}T09:00:00.000Z`, Season: "2026-2027", "Home Team": "E", "Away Team": "Opponent", "Match Status": "Scheduled", "Selected Players Home": [], "Target Squad Size": 14 } },
      { id: "recM_F", fields: { Date: `${DAY1}T11:00:00.000Z`, Season: "2026-2027", "Home Team": "F", "Away Team": "Opponent", "Match Status": "Scheduled", "Selected Players Home": [], "Target Squad Size": 14 } },
    ],
    exceptions: [
      // Jonny (display E): Maybe for the E fixture, Unavailable for the F fixture.
      { id: "recX1", fields: { Player: ["recA"], Match: ["recM_E"], "Availability Status": "Maybe", "Season (Matches)": "2026-2027" } },
      { id: "recX2", fields: { Player: ["recA"], Match: ["recM_F"], "Availability Status": "Unavailable", "Season (Matches)": "2026-2027" } },
      // Tom (display E): Maybe for the E fixture.
      { id: "recX3", fields: { Player: ["recB"], Match: ["recM_E"], "Availability Status": "Maybe", "Season (Matches)": "2026-2027" } },
      // Harry (display F): Unavailable for the F fixture.
      { id: "recX4", fields: { Player: ["recC"], Match: ["recM_F"], "Availability Status": "Unavailable", "Season (Matches)": "2026-2027" } },
    ],
  };
}

function installFakeAirtable() {
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

async function tileFor(team: string) {
  const { fixtures } = await getUpcomingFixtures(ENV, { team });
  expect(fixtures).toHaveLength(1);
  return fixtures[0];
}

describe("coach fixture tiles: availability counts scoped to the fixture's Selected Team", () => {
  it("E tile: counts only players whose Selected Team is E (Jonny + Tom)", async () => {
    const tile = await tileFor("E");
    expect(tile.maybeCount).toBe(2);
    expect(tile.maybeNames?.sort()).toEqual(["Jonny", "Tom"]);
    // Jonny's Unavailable mark belongs to the F tile (his marks are counted
    // where his Selected Team plays) - the E tile has no unavailable players.
    expect(tile.unavailableCount).toBe(0);
    expect(tile.unavailableNames ?? []).toHaveLength(0);
  });

  it("F tile: counts only players whose Selected Team is F (Harry); Jonny's mark is excluded", async () => {
    const tile = await tileFor("F");
    expect(tile.unavailableCount).toBe(1);
    expect(tile.unavailableNames).toEqual(["Harry"]);
    // Jonny is displayed as an E player - his Unavailable mark on the F
    // fixture does not appear on the F tile.
    expect(tile.maybeCount).toBe(0);
    expect(tile.maybeNames ?? []).toHaveLength(0);
  });

  it("derby safety: a match between two club teams splits marks by card", async () => {
    state.matches.push({ id: "recM_EF", fields: { Date: `${new Date(Date.now() + 9 * 86_400_000).toISOString().split("T")[0]}T10:00:00.000Z`, Season: "2026-2027", "Home Team": "E", "Away Team": "F", "Match Status": "Scheduled", "Selected Players Home": [], "Target Squad Size": 14 } });
    state.exceptions.push(
      { id: "recX5", fields: { Player: ["recA"], Match: ["recM_EF"], "Availability Status": "Maybe", "Season (Matches)": "2026-2027" } },
      { id: "recX6", fields: { Player: ["recC"], Match: ["recM_EF"], "Availability Status": "Unavailable", "Season (Matches)": "2026-2027" } },
    );
    const eTile = (await (async () => {
      const { fixtures } = await getUpcomingFixtures(ENV, { team: "E" });
      return fixtures.find((f: any) => f.id === "recM_EF");
    })());
    const fTile = (await (async () => {
      const { fixtures } = await getUpcomingFixtures(ENV, { team: "F" });
      return fixtures.find((f: any) => f.id === "recM_EF");
    })());
    // E side card: Jonny (display E). F side card: Harry (display F).
    expect(eTile?.maybeNames).toEqual(["Jonny"]);
    expect(eTile?.unavailableNames ?? []).toHaveLength(0);
    expect(fTile?.unavailableNames).toEqual(["Harry"]);
    expect(fTile?.maybeNames ?? []).toHaveLength(0);
  });
});
