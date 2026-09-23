import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Higher team priority on save (Bye-Law 7.1, Sept 2026; spec §7.3).
//
// Nobody plays for two teams on a match day, U21s included. When a higher
// team picks a player a same-day lower team already has, the save takes the
// player out of the lower squad and reports it back.
// ---------------------------------------------------------------------------

import { syncSquad } from "../worker/src/squad";
import { invalidateAll } from "../worker/src/cache";
import { fakeAirtable, type FakeTables } from "./helpers/airtable";

const ENV = {
  AIRTABLE_TOKEN: "***",
  AIRTABLE_BASE_ID: "test-base",
  CALENDAR_SECRET: "***",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

const DAY = "2026-09-26";

function person(id: string, name: string, team: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    fields: {
      "Preferred Name": name, Surname: "S", Email: `${id}@hkfc.com`, Active: true, Status: "Active",
      "Registered Team": team, "Playing Position": "Midfielder", "Playing Ability": "C", ...extra,
    },
  };
}

function fixture(id: string, home: string, selected: string[], extra: Record<string, unknown> = {}) {
  return {
    id,
    fields: {
      Date: `${DAY}T02:00:00.000Z`, Season: "2026-27", Division: "Div 3", "Home Team": home, "Away Team": `Opp ${id}`,
      Venue: "P1", "Match Status": "Scheduled", "Selected Players Home": selected, "Selected Players Away": [], ...extra,
    },
  };
}

let tables: FakeTables;

function install(matches: ReturnType<typeof fixture>[]) {
  tables = {
    Teams: ["HKFC A", "HKFC B", "HKFC C", "HKFC D", "HKFC E"].map((n, i) => ({
      id: `recT${i}`, fields: { "Team Name": n, "Team Rank": i + 1, Active: true, "Target Squad Size": 14 },
    })),
    People: [
      person("recU21", "Uma", "HKFC D", { "U21 Eligible": true }),
      person("recSam", "Sam", "HKFC D"),
      person("recKim", "Kim", "HKFC D"),
    ],
    Matches: matches,
  };
  fakeAirtable(tables);
}

const selected = (matchId: string) =>
  tables.Matches.find((r) => r.id === matchId)?.fields["Selected Players Home"];

beforeEach(() => invalidateAll());
afterEach(() => vi.unstubAllGlobals());

describe("syncSquad: higher team priority", () => {
  it("takes a U21 out of their own team's squad when a higher team picks them", async () => {
    install([fixture("recLow", "HKFC D", ["recU21", "recKim"]), fixture("recHigh", "HKFC B", [])]);

    const { displaced } = await syncSquad(ENV, "recHigh", ["recU21"], "coach@hkfc.com", "home");

    expect(selected("recHigh")).toEqual(["recU21"]);
    expect(selected("recLow")).toEqual(["recKim"]);
    expect(displaced).toEqual([{ playerId: "recU21", playerName: "Uma S", team: "HKFC D", matchId: "recLow" }]);
  });

  it("does the same for any player, not only U21s", async () => {
    install([fixture("recLow", "HKFC D", ["recSam"]), fixture("recHigh", "HKFC B", [])]);

    const { displaced } = await syncSquad(ENV, "recHigh", ["recSam"], "coach@hkfc.com", "home");

    expect(selected("recLow")).toEqual([]);
    expect(displaced.map((d) => d.playerId)).toEqual(["recSam"]);
  });

  it("leaves players already in the squad where they are (only new picks move)", async () => {
    // Re-saving a squad must not keep reaching into other squads.
    install([fixture("recLow", "HKFC D", ["recKim"]), fixture("recHigh", "HKFC B", ["recSam"])]);

    const { displaced } = await syncSquad(ENV, "recHigh", ["recSam"], "coach@hkfc.com", "home");

    expect(displaced).toEqual([]);
    expect(selected("recLow")).toEqual(["recKim"]);
  });

  it("does not rewrite a lower squad whose match has been played", async () => {
    install([
      fixture("recLow", "HKFC D", ["recSam"], { "Match Status": "Played" }),
      fixture("recHigh", "HKFC B", []),
    ]);

    const { displaced } = await syncSquad(ENV, "recHigh", ["recSam"], "coach@hkfc.com", "home");

    expect(displaced).toEqual([]);
    expect(selected("recLow")).toEqual(["recSam"]);
  });

  it("still rejects the reverse: a lower team cannot take a player a higher team has", async () => {
    install([fixture("recLow", "HKFC D", []), fixture("recHigh", "HKFC B", ["recU21"])]);

    await expect(syncSquad(ENV, "recLow", ["recU21"], "coach@hkfc.com", "home")).rejects.toThrow(
      /Selected for HKFC B on same day/,
    );
    expect(selected("recHigh")).toEqual(["recU21"]);
  });
});
