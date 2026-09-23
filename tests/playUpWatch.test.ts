import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Play-Up Watch lists players against their own allowance (Bye-Law 7.2(b),
// Sept 2026): three for most players, eight for U21s.

import { getPlayUpWatch } from "../worker/src/dashboard";
import { currentSeason } from "../worker/src/seasonContext";
import { invalidateAll } from "../worker/src/cache";
import { fakeAirtable } from "./helpers/airtable";

const ENV = {
  AIRTABLE_TOKEN: "***",
  AIRTABLE_BASE_ID: "test-base",
  CALENDAR_SECRET: "***",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

const season = currentSeason();

function person(id: string, u21: boolean) {
  return {
    id,
    fields: {
      "Preferred Name": id, Surname: "S", Email: `${id}@hkfc.com`, Active: true, Status: "Active",
      "Registered Team": "HKFC C", "Playing Position": "Midfielder", "Playing Ability": "C", "U21 Eligible": u21,
    },
  };
}

function playUps(playerId: string, n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `rec${playerId}${i}`,
    fields: {
      Player: [playerId], Match: [`recM${i}`], Team: "HKFC B", "Player Team": "HKFC C",
      "Play Up?": true, Goalkeeper: false, Season: season,
    },
  }));
}

beforeEach(() => {
  invalidateAll();
  fakeAirtable({
    Teams: ["HKFC A", "HKFC B", "HKFC C"].map((n, i) => ({
      id: `recT${i}`, fields: { "Team Name": n, "Team Rank": i + 1, Active: true },
    })),
    People: [person("std2", false), person("u21on3", true), person("u21on7", true), person("u21on9", true)],
    Matches: Array.from({ length: 9 }, (_, i) => ({
      id: `recM${i}`,
      fields: { Date: `2026-09-0${i + 1}T02:00:00.000Z`, Season: season, Division: "Div 1", "Home Team": "HKFC B", "Away Team": "Opp", "Match Status": "Played" },
    })),
    "Match Cards": [...playUps("std2", 2), ...playUps("u21on3", 3), ...playUps("u21on7", 7), ...playUps("u21on9", 9)],
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("getPlayUpWatch", () => {
  it("watches each player from one short of their own allowance", async () => {
    const { watch } = await getPlayUpWatch(ENV);
    const rows = Object.fromEntries(watch.map((w) => [w.id, w]));

    expect(rows.std2).toMatchObject({ playUpCount: 2, playUpAllowance: 3 });
    // Three play-ups is nowhere near a U21's limit.
    expect(rows.u21on3).toBeUndefined();
    expect(rows.u21on7).toMatchObject({ playUpCount: 7, playUpAllowance: 8 });
    expect(rows.u21on9).toMatchObject({ playUpCount: 9, playUpAllowance: 8 });
  });

  it("orders by distance from each player's allowance, most urgent first", async () => {
    const { watch } = await getPlayUpWatch(ENV);
    expect(watch.map((w) => w.id)).toEqual(["u21on9", "std2", "u21on7"]);
  });
});
