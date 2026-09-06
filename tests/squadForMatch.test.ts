import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// GET /api/match/:id/squad (worker/src/squad.ts :: getSquadForMatch)
//
// Regression for the derby bug: the route previously never read `?side=`,
// so an away player on a derby fixture was shown the home squad. The
// underlying getSquadForMatch already accepted `side` - this asserts it
// actually returns the respective side's list end to end.
// ---------------------------------------------------------------------------

import { getSquadForMatch } from "../worker/src/squad";
import { invalidateAll } from "../src/lib/cache";

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

function installFakeAirtable() {
  const fetchMock = vi.fn((url: any) => {
    const u = String(url);
    if (!u.includes("api.airtable.com")) return Promise.resolve(new Response("{}", { status: 404 }));
    const table = decodeURIComponent((u.match(/\/v0\/[^/]+\/([^/?]+)/) ?? [])[1] ?? "");
    const store = table === "People" ? PEOPLE : table === "Teams" ? TEAMS : table === "Matches" ? [DERBY] : [];
    const byId = u.match(/\/rec[A-Za-z0-9]+$/);
    if (byId) {
      const found = store.find((r) => r.id === byId[0].slice(1));
      return Promise.resolve(new Response(JSON.stringify(found ?? {}), { status: found ? 200 : 404 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ records: store }), { status: 200 }));
  }) as any;
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  invalidateAll();
  installFakeAirtable();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getSquadForMatch on a derby", () => {
  it("returns the home squad for side=home", async () => {
    const result = await getSquadForMatch(ENV, "recDerby", "home");
    expect(result.players.map((p) => p.id)).toEqual(["recHome"]);
  });

  it("returns the away squad for side=away", async () => {
    invalidateAll();
    const result = await getSquadForMatch(ENV, "recDerby", "away");
    expect(result.players.map((p) => p.id)).toEqual(["recAway"]);
  });
});
