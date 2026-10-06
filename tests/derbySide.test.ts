import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Derby side resolution (worker/src/squad.ts :: resolveHkfcSide), through
// getPlayersForMatch.
//
// On a derby both sides are HKFC teams, so `?side=` is the only thing that
// says whose squad is wanted. Regression for the derby bug: a read that
// ignored the side showed the away team the home squad. These assertions
// used to sit on getSquadForMatch, which was removed with its unused route.
// ---------------------------------------------------------------------------

import { getPlayersForMatch } from "../worker/src/squad";
import { invalidateAll } from "../worker/src/cache";
import { fakeAirtable } from "./helpers/airtable";

const ENV = {
  AIRTABLE_TOKEN: "***",
  AIRTABLE_BASE_ID: "test-base",
  CALENDAR_SECRET: "***",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

const TEAMS = [
  { id: "recTB", fields: { "Team Name": "HKFC B", "Team Rank": 2, Active: true } },
  { id: "recTC", fields: { "Team Name": "HKFC C", "Team Rank": 3, Active: true } },
];

const PEOPLE = [
  { id: "recHome", fields: { "Preferred Name": "Homer", Active: true, "Registered Team": "HKFC B", "Playing Position": "Defender" } },
  { id: "recAway", fields: { "Preferred Name": "Awena", Active: true, "Registered Team": "HKFC C", "Playing Position": "Forward" } },
];

const DERBY = {
  id: "recDerby",
  fields: {
    Date: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    Season: "2026-2027",
    "Home Team": "HKFC B",
    "Away Team": "HKFC C",
    "Match Status": "Scheduled",
    "Selected Players Home": ["recHome"],
    "Selected Players Away": ["recAway"],
  },
};

beforeEach(() => {
  invalidateAll();
  fakeAirtable({
    People: PEOPLE,
    Teams: TEAMS,
    Matches: [DERBY],
    "Availability Exceptions": [],
    "Match Cards": [],
    "Availability Rules": [],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function selectedIds(side: "home" | "away") {
  const result = await getPlayersForMatch(ENV, "recDerby", side);
  return {
    team: result.match.hkfcTeam,
    selected: result.players.filter((p) => p.selectionStatus === "Selected").map((p) => p.id),
  };
}

describe("getPlayersForMatch on a derby", () => {
  it("reads the home squad for side=home", async () => {
    expect(await selectedIds("home")).toEqual({ team: "HKFC B", selected: ["recHome"] });
  });

  it("reads the away squad for side=away", async () => {
    expect(await selectedIds("away")).toEqual({ team: "HKFC C", selected: ["recAway"] });
  });
});
