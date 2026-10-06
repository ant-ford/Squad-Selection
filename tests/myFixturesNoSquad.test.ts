import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// The squad list on each fixture is for the calendar feed (its SQUAD block).
// The dashboard never shows it, so /api/my-fixtures leaves it out: it was
// most of the response for a player who sees a lot of play-ups.
// ---------------------------------------------------------------------------

import { getMyFixtures, getPlayerFixtures } from "../worker/src/fixtures";
import { handlePlayerCalendarFeed } from "../worker/src/calendar";
import { invalidateAll } from "../worker/src/cache";
import { fakeAirtable, type FakeTables } from "./helpers/airtable";
import type { AuthorizedUser } from "../worker/src/auth";

const ENV = {
  AIRTABLE_TOKEN: "***",
  AIRTABLE_BASE_ID: "test-base",
  CALENDAR_SECRET: "test-calendar-secret",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

const authUser: AuthorizedUser = {
  email: "jonny@hkfc.com", personId: "", role: "player", coachTeams: [], isSectionCaptain: false, officerRoles: [],
};

const DAY = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().split("T")[0];

function person(id: string, name: string, team: string, position: string) {
  return {
    id,
    fields: {
      "Preferred Name": name, Email: `${name.toLowerCase()}@hkfc.com`, Active: true,
      "Registered Team": team, "Playing Ability": "B", "Playing Position": position,
    },
  };
}

function tables(): FakeTables {
  return {
    People: [person("recP1", "Jonny", "F", "Forward"), person("recP2", "Sam", "F", "Goalkeeper")],
    Teams: ["A", "B", "C", "D", "E", "F", "G", "H"].map((n, i) => ({
      id: `recT${i}`,
      fields: { "Team Name": n, "Team Rank": i + 1, Active: true },
    })),
    Matches: [
      {
        id: "recM_F",
        fields: {
          Date: `${DAY(2)}T09:00:00.000Z`, Season: "2026-2027", "Home Team": "F", "Away Team": "Opponent",
          "Match Status": "Scheduled", "Selected Players Home": ["recP1", "recP2"],
        },
      },
    ],
    "Availability Exceptions": [],
  };
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(ENV.CALENDAR_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

beforeEach(() => {
  invalidateAll();
  fakeAirtable(tables());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("squad on player fixtures", () => {
  it("is left out of the dashboard response", async () => {
    const out = await getMyFixtures(ENV, authUser);
    expect(out.fixtures).toHaveLength(1);
    expect(out.fixtures[0].selectedCount).toBe(2);
    expect(out.fixtures[0]).not.toHaveProperty("squad");
    expect(JSON.stringify(out)).not.toContain('"squad"');
  });

  it("is still there for the calendar feed", async () => {
    const { fixtures } = await getPlayerFixtures(ENV, "recP1");
    expect(fixtures[0].squad.map((p: { name: string }) => p.name)).toEqual(["Jonny", "Sam"]);

    const res = await handlePlayerCalendarFeed(ENV, "recP1", await sign("player:recP1"));
    const ics = (await res.text()).replace(/\r\n /g, "");
    expect(ics).toContain("SQUAD (2)");
    expect(ics).toMatch(/SQUAD \(2\)\\nSam\\nJonny/);
  });
});
