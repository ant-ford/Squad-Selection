import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// The "Available for X on same day" chip on the coach's player list, end to
// end through getPlayersForMatch, with a standing preference in play.
//
// The pure engine tests cover explicit exceptions; this covers the piece the
// engine cannot see on its own - a player whose "no" comes from an
// availability preference rather than a tap. buildEvaluationContext resolves
// those for the day's other fixtures and feeds them in.
// ---------------------------------------------------------------------------

import { getPlayersForMatch } from "../worker/src/squad";
import { invalidateAll } from "../worker/src/cache";
import { fakeAirtable, type FakeTables } from "./helpers/airtable";

const ENV = {
  AIRTABLE_TOKEN: "***",
  AIRTABLE_BASE_ID: "test-base",
  CALENDAR_SECRET: "***",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

// A Saturday a week out. B and C are both non-Premier, so the Premier
// movement restriction is not in play and the only questions are the
// players' answers.
const DAY = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0];

const TEAMS = [
  { id: "recTB", fields: { "Team Name": "HKFC B", "Team Rank": 2, Active: true } },
  { id: "recTC", fields: { "Team Name": "HKFC C", "Team Rank": 3, Active: true } },
];

const person = (id: string, name: string, position = "Defender") => ({
  id,
  fields: { "Preferred Name": name, Email: `${name}@hkfc.com`, Active: true, "Registered Team": "HKFC C", "Playing Position": position, "Playing Ability": "C" },
});

const match = (id: string, team: string, hour: string) => ({
  id,
  fields: { Date: `${DAY}T${hour}:00:00.000Z`, Season: "2026-2027", "Home Team": team, "Away Team": "Valley", "Match Status": "Scheduled" },
});

let state: Record<string, any[]>;

beforeEach(() => {
  invalidateAll();
  state = {
    People: [
      person("recPlain", "Plain"),
      person("recRule", "Rule", "Goalkeeper"),
      person("recExplicit", "Explicit"),
      person("recMaybe", "Maybe"),
      person("recOverride", "Override"),
    ],
    Teams: TEAMS.map((t) => ({ id: t.id, fields: { ...t.fields } })),
    Matches: [match("recMC", "HKFC C", "05"), match("recMB", "HKFC B", "07")],
    "Availability Exceptions": [
      // Explicit: said no to the B game.
      { id: "recX1", fields: { Player: ["recExplicit"], Match: ["recMB"], "Availability Status": "Unavailable", "Season (Matches)": "2026-2027" } },
      // Maybe: only a maybe for the B game.
      { id: "recX2", fields: { Player: ["recMaybe"], Match: ["recMB"], "Availability Status": "Maybe", "Season (Matches)": "2026-2027" } },
      // Override: a preference says no to play-ups, but they answered Maybe
      // for this one, and an explicit answer beats the preference.
      { id: "recX3", fields: { Player: ["recOverride"], Match: ["recMB"], "Availability Status": "Maybe", "Season (Matches)": "2026-2027" } },
    ],
    "Match Cards": [],
    "Availability Rules": [
      { id: "recR1", fields: { Player: ["recRule"], "Rule Type": "Play-ups", Availability: "Unavailable", Active: true } },
      { id: "recR2", fields: { Player: ["recOverride"], "Rule Type": "Play-ups", Availability: "Unavailable", Active: true } },
    ],
  };
  const tables: FakeTables = {};
  for (const name of Object.keys(state)) {
    Object.defineProperty(tables, name, { get: () => state[name], enumerable: true });
  }
  fakeAirtable(tables);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function rows() {
  const { players } = await getPlayersForMatch(ENV, "recMC");
  return new Map(players.map((p) => [p.id, p]));
}

describe("the same-day availability chip on the C team's list", () => {
  it("names B for a player who has said nothing about the B game", async () => {
    const plain = (await rows()).get("recPlain")!;
    expect(plain.warnings).toContain("Available for HKFC B on same day");
    expect(plain.sameDayHigherTeam).toBe("HKFC B");
  });

  it("is silent for a player whose preference says no to play-ups", async () => {
    const keeper = (await rows()).get("recRule")!;
    expect(keeper.warnings).toEqual([]);
    expect(keeper.sameDayHigherTeam).toBeNull();
    expect(keeper.conflicts.filter((c) => c.type === "available")).toEqual([]);
    // Their own fixture is unaffected by that preference.
    expect(keeper.availabilityStatus).toBe("Available");
    expect(keeper.eligibilityStatus).toBe("eligible");
  });

  it("is silent for a player who answered Unavailable for the B game", async () => {
    const explicit = (await rows()).get("recExplicit")!;
    expect(explicit.warnings).toEqual([]);
    expect(explicit.sameDayHigherTeam).toBeNull();
  });

  it("still names B for a Maybe", async () => {
    expect((await rows()).get("recMaybe")!.warnings).toContain("Available for HKFC B on same day");
  });

  it("lets an explicit Maybe for the B game beat a no-play-ups preference", async () => {
    expect((await rows()).get("recOverride")!.warnings).toContain("Available for HKFC B on same day");
  });
});
