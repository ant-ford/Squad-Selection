import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Player calendar consistency with the player dashboard (Selected Team view)
//
// handlePlayerCalendarFeed consumes buildPlayerFixtureView (the SAME
// categorised fixture logic as the dashboard) via getPlayerFixtures, so the
// subscribed calendar reflects My Team / Play-Up Opportunities / Support
// Fixtures exactly as the player sees them. Coach/team calendars remain team
// subscriptions and are unaffected by individual players' Selected Team.
// ---------------------------------------------------------------------------

import { handlePlayerCalendarFeed, handleTeamCalendarFeed } from "../worker/src/calendar";
import { invalidateAll, invalidateCache } from "../src/lib/cache";

const ENV = {
  AIRTABLE_TOKEN: "***",
  AIRTABLE_BASE_ID: "test-base",
  CALENDAR_SECRET: "test-calendar-secret",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

/** Date-rot-proof fixture date keys. */
const DAY = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().split("T")[0];

const TEAMS = ["A", "B", "C", "D", "E", "F", "G", "H"].map((n, i) => ({
  id: `recT${i}`,
  fields: { "Team Name": n, "Team Rank": i + 1, Active: true },
}));

let state: { people: any[]; teams: any[]; matches: any[]; exceptions: any[] };

function seedPeople(overrides: { selectedTeamEos?: string; suspended?: boolean } = {}) {
  state.people = [
    {
      id: "recP1",
      fields: {
        "Preferred Name": "Jonny",
        Email: "jonny@hkfc.com",
        Active: true,
        "Registered Team": "F",
        "Playing Ability": "B",
        "Selected Team EOS": overrides.selectedTeamEos,
        "Is Suspended": overrides.suspended ?? false,
        "Playing Position": "Forward",
      },
    },
  ];
}

function match(id: string, homeTeam: string, day: number, selectedHome: string[] = []): any {
  return {
    id,
    fields: {
      Date: `${DAY(day)}T09:00:00.000Z`,
      Season: "2026-2027",
      "Home Team": homeTeam,
      "Away Team": "Opponent",
      "Match Status": "Scheduled",
      "Selected Players Home": selectedHome,
    },
  };
}

function seed() {
  state = {
    people: [],
    teams: TEAMS.map((t) => ({ id: t.id, fields: { ...t.fields } })),
    matches: [],
    exceptions: [],
  };
}

function installFakeAirtable() {
  const fetchMock = vi.fn((url: any, init?: any) => {
    const u = String(url);
    if (!u.includes("api.airtable.com")) return Promise.resolve(new Response("{}", { status: 404 }));
    const table = decodeURIComponent((u.match(/\/v0\/[^/]+\/([^/?]+)/) ?? [])[1] ?? "");
    const store = (): any[] =>
      table === "People" ? state.people : table === "Teams" ? state.teams : table === "Matches" ? state.matches : table === "Availability Exceptions" ? state.exceptions : [];

    // Honest filterByFormula emulation for People email lookups.
    if (table === "People" && u.includes("filterByFormula")) {
      const q = new URLSearchParams(u.split("?")[1] ?? "");
      const formula = decodeURIComponent(q.get("filterByFormula") || "");
      const m = formula.match(/"([^"]+)"/);
      const needle = m ? m[1].toLowerCase() : "";
      const filtered = store().filter((r) => (r.fields?.Email || "").toLowerCase() === needle);
      return Promise.resolve(new Response(JSON.stringify({ records: filtered }), { status: 200 }));
    }

    const byId = u.match(/\/rec[A-Za-z0-9]+$/);
    if (byId) {
      const found = store().find((r) => r.id === byId[0].slice(1));
      if (!found) return Promise.resolve(new Response("Not found", { status: 404 }));
      return Promise.resolve(new Response(JSON.stringify(found), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ records: store() }), { status: 200 }));
  }) as any;
  vi.stubGlobal("fetch", fetchMock);
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(ENV.CALENDAR_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Unfold RFC 5545 folded lines so assertions see whole logical lines. */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n /g, "").split("\r\n");
}

function eventsWith(ics: string, needle: string): string[] {
  return unfold(ics).filter((l) => l.startsWith("SUMMARY:") && l.includes(needle));
}

function categoriesFor(ics: string, teamNeedle: string): string[] {
  const lines = unfold(ics);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("SUMMARY:") && lines[i].includes(teamNeedle)) {
      for (let j = i; j < Math.min(i + 12, lines.length); j++) {
        if (lines[j].startsWith("DESCRIPTION:")) {
          const m = lines[j].match(/Category: ([^\\]+)/);
          if (m) out.push(m[1]);
        }
      }
    }
  }
  return out;
}

beforeEach(() => {
  invalidateAll();
  seed();
  seedPeople();
  installFakeAirtable();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("player calendar (Selected Team view)", () => {
  it("registered F + Selected E: E = My Team, D = Play-Up Opportunity, F hidden (selected for E same day)", async () => {
    seedPeople({ selectedTeamEos: "E" });
    state.matches = [
      match("recM_E", "E", 1, ["recP1"]), // Jonny selected for E
      match("recM_D", "D", 1),
      match("recM_F", "F", 1),
      match("recM_G", "G", 1), // engine blocks (committee) -> absent
      match("recM_H", "H", 1), // engine blocks (committee) -> absent
    ];
    const sig = await sign(`player:recP1`);
    const res = await handlePlayerCalendarFeed(ENV, "recP1", sig);
    const ics = await res.text();

    // My Team: the E fixture (selected) - no play-up badge.
    expect(eventsWith(ics, "E vs")).toHaveLength(1);
    expect(categoriesFor(ics, "E vs")).toEqual(["My Team"]);
    // Play-Up Opportunity: the D fixture (one team above the display team).
    expect(eventsWith(ics, "D vs")).toHaveLength(1);
    expect(categoriesFor(ics, "D vs")).toEqual(["Play-Up Opportunity"]);
    // Jonny is SELECTED for the higher E fixture on the same day -> his own
    // F team's fixture is ineligible that day (same-day rule).
    expect(eventsWith(ics, "F vs")).toHaveLength(0);
    // G/H are engine-blocked (Committee approval) -> absent.
    expect(eventsWith(ics, "G vs")).toHaveLength(0);
    expect(eventsWith(ics, "H vs")).toHaveLength(0);
  });

  it("registered F + merely available for E (not selected): F support remains visible", async () => {
    // Product decision 2026-09-03: availability for a higher team does not
    // make the player unavailable for their own team. Same fixtures as the
    // Jonny case, but Jonny is NOT selected for the E squad.
    seedPeople({ selectedTeamEos: "E" });
    state.matches = [
      match("recM_E", "E", 1),
      match("recM_D", "D", 1),
      match("recM_F", "F", 1),
    ];
    const sig = await sign(`player:recP1`);
    const res = await handlePlayerCalendarFeed(ENV, "recP1", sig);
    const ics = await res.text();
    expect(eventsWith(ics, "E vs")).toHaveLength(1);
    expect(eventsWith(ics, "D vs")).toHaveLength(1);
    expect(eventsWith(ics, "F vs")).toHaveLength(1);
    expect(categoriesFor(ics, "F vs")).toEqual(["Support Fixture"]);
  });

  it("registered F with no Selected Team falls back to F as My Team", async () => {
    seedPeople({});
    state.matches = [
      match("recM_F", "F", 1),
      match("recM_E", "E", 1), // one above display F -> play-up
    ];
    const sig = await sign(`player:recP1`);
    const res = await handlePlayerCalendarFeed(ENV, "recP1", sig);
    const ics = await res.text();
    expect(categoriesFor(ics, "F vs")).toEqual(["My Team"]);
    expect(categoriesFor(ics, "E vs")).toEqual(["Play-Up Opportunity"]);
  });

  it("changing Selected Team EOS changes the player calendar output", async () => {
    seedPeople({ selectedTeamEos: "E" });
    state.matches = [
      match("recM_E", "E", 1),
      match("recM_D", "D", 1),
    ];
    const sig = await sign(`player:recP1`);

    // EOS = E: My Team = E, D = play-up.
    const res1 = await handlePlayerCalendarFeed(ENV, "recP1", sig);
    const ics1 = await res1.text();
    expect(categoriesFor(ics1, "E vs")).toEqual(["My Team"]);
    expect(categoriesFor(ics1, "D vs")).toEqual(["Play-Up Opportunity"]);

    // The captain changes Selected Team EOS to D in Airtable.
    state.people[0].fields["Selected Team EOS"] = "D";
    // Simulate the natural reference-cache refresh (10-minute TTL).
    invalidateCache("club-reference");

    const res2 = await handlePlayerCalendarFeed(ENV, "recP1", sig);
    const ics2 = await res2.text();
    // My Team is now D; E drops to a play-up opportunity.
    expect(categoriesFor(ics2, "D vs")).toEqual(["My Team"]);
    expect(eventsWith(ics2, "E vs")).toHaveLength(0); // E is no longer advertised (below the new display team)
  });

  it("eligibility still uses the Registered Team: a suspended player keeps My Team but loses play-ups/support", async () => {
    seedPeople({ selectedTeamEos: "E", suspended: true });
    state.matches = [
      match("recM_E", "E", 1, ["recP1"]),
      match("recM_D", "D", 1),
      match("recM_F", "F", 1),
    ];
    const sig = await sign(`player:recP1`);
    const res = await handlePlayerCalendarFeed(ENV, "recP1", sig);
    const ics = await res.text();
    expect(eventsWith(ics, "E vs")).toHaveLength(1); // My Team unaffected
    expect(eventsWith(ics, "D vs")).toHaveLength(0); // suspended -> play-up hidden
    expect(eventsWith(ics, "F vs")).toHaveLength(0); // suspended -> support hidden
  });
});

describe("team calendar (coach subscriptions)", () => {
  it("the E team calendar remains E fixtures regardless of a player's Selected Team", async () => {
    seedPeople({ selectedTeamEos: "D" }); // a player's EOS points at D - irrelevant to team feeds
    state.matches = [
      match("recM_E", "E", 1),
      match("recM_D", "D", 1),
      match("recM_F", "F", 1),
    ];
    const sig = await sign(`team:E`);
    const res = await handleTeamCalendarFeed(ENV, "E", sig);
    const ics = await res.text();
    expect(eventsWith(ics, "E vs")).toHaveLength(1);
    expect(eventsWith(ics, "D vs")).toHaveLength(0);
    expect(eventsWith(ics, "F vs")).toHaveLength(0);
    // Team events carry no player-category line.
    expect(unfold(ics).some((l) => l.includes("Category:"))).toBe(false);
  });
});
