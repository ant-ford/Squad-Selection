import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Lowest-ranked-team Goalkeeper schedule (worker/src/fixtures.ts)
// ---------------------------------------------------------------------------

import {
  getLowestRankedTeamName,
  isSpecialGoalkeeper,
  getMyFixtures,
} from "../worker/src/fixtures";
import { invalidateAll } from "../src/lib/cache";
import type { ReferenceData } from "../worker/src/reference";
import type { AuthorizedUser } from "../worker/src/auth";

function authUser(email: string): AuthorizedUser {
  return { email, personId: "", role: "player", coachTeams: [], isSectionCaptain: false };
}

const ENV = {
  AIRTABLE_TOKEN: "***",
  AIRTABLE_BASE_ID: "test-base",
  CALENDAR_SECRET: "***",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

/** Date-rot-proof fixture dates: always N days in the future. */
function futureIso(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

// ---------------------------------------------------------------------------
// Pure cohort logic
// ---------------------------------------------------------------------------

function ref(teams: { name: string; rank: number; active?: boolean }[]): ReferenceData {
  const t = teams.map((x) => ({
    id: `recT_${x.name}`,
    teamName: x.name,
    teamRank: x.rank,
    active: x.active ?? true,
    coach: [],
    teamCaptain: [],
    sectionCaptain: [],
    autoSelectPlayers: [],
    isPremier: false,
    targetSquadSize: 14,
  }));
  return {
    players: [],
    teams: t,
    teamRankMap: Object.fromEntries(t.map((x) => [x.teamName, x.teamRank ?? 99])),
    teamNames: t.map((x) => x.teamName || ""),
  };
}

function gk(name: string, team: string, opts: { active?: boolean; position?: string } = {}) {
  return {
    id: `recP_${name}`,
    preferredName: name,
    active: opts.active ?? true,
    registeredTeam: team,
    playingPosition: opts.position ?? "Goalkeeper",
  } as any;
}

describe("getLowestRankedTeamName", () => {
  it("returns the team with the highest Team Rank (never hardcoded)", () => {
    expect(getLowestRankedTeamName(ref([{ name: "A", rank: 1 }, { name: "H", rank: 8 }]))).toBe("H");
    expect(getLowestRankedTeamName(ref([{ name: "A", rank: 1 }, { name: "D", rank: 4 }]))).toBe("D");
  });
  it("returns empty string for no teams", () => {
    expect(getLowestRankedTeamName(ref([]))).toBe("");
  });
});

describe("isSpecialGoalkeeper", () => {
  const standard = ref(["A", "B", "C", "D", "E", "F", "G", "H"].map((n, i) => ({ name: n, rank: i + 1 })));

  it("true for an active Goalkeeper registered to the lowest-ranked team (H)", () => {
    expect(isSpecialGoalkeeper(gk("Bob", "H"), standard)).toBe(true);
  });

  it("true when the lowest-ranked team is not H (derived from data)", () => {
    const r = ref([{ name: "A", rank: 1 }, { name: "D", rank: 4 }]);
    expect(isSpecialGoalkeeper(gk("Kim", "D"), r)).toBe(true);
    expect(isSpecialGoalkeeper(gk("Kim", "H"), r)).toBe(false);
  });

  it("false for an outfield player on the lowest team", () => {
    expect(isSpecialGoalkeeper(gk("Sam", "H", { position: "Defender" }), standard)).toBe(false);
  });

  it("false for a Goalkeeper registered to a higher team", () => {
    expect(isSpecialGoalkeeper(gk("Ali", "A"), standard)).toBe(false);
  });

  it("false for an inactive Goalkeeper on the lowest team", () => {
    expect(isSpecialGoalkeeper(gk("Bob", "H", { active: false }), standard)).toBe(false);
  });

  it("false when the player has no registered team", () => {
    expect(isSpecialGoalkeeper(gk("Bob", ""), standard)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getMyFixtures integration (fake Airtable)
// ---------------------------------------------------------------------------

const TEAM_RECORDS = ["A", "B", "C", "D", "E", "F", "G", "H"].map((n, i) => ({
  id: `recT${i}`,
  fields: { "Team Name": n, "Team Rank": i + 1, Active: true, "Target Squad Size": 14 },
}));

const PLAYER_RECORDS = [
  { id: "recP2", fields: { "Preferred Name": "Bob", Surname: "B", Email: "bob@hkfc.com", Active: true, "Registered Team": "H", "Playing Position": "Goalkeeper", "Playing Ability": "H", Status: "Active" } },
  { id: "recP4", fields: { "Preferred Name": "Dave", Surname: "D", Email: "dave@hkfc.com", Active: true, "Registered Team": "A", "Playing Position": "Defender", "Playing Ability": "A", Status: "Active" } },
];

const MATCH_RECORDS = [
  { id: "recM1", fields: { Date: futureIso(3), Season: "2026-27", Division: "Div 1", "Home Team": "A", "Away Team": "Valley A", Venue: "P1", "Match Status": "Scheduled", "Selected Players Home": ["recP2"], "Selected Players Away": [] } },
  { id: "recM4", fields: { Date: futureIso(4), Season: "2026-27", Division: "Div 1", "Home Team": "A", "Away Team": "B", Venue: "P1", "Match Status": "Scheduled", "Selected Players Home": [], "Selected Players Away": ["recP2"] } },
  { id: "recM6", fields: { Date: futureIso(5), Season: "2026-27", Division: "Div 5", "Home Team": "Valley B", "Away Team": "Valley C", Venue: "Other", "Match Status": "Scheduled", "Selected Players Home": [], "Selected Players Away": [] } },
];

const EXCEPTION_RECORDS = [
  { id: "recE1", fields: { Player: ["recP2"], Match: ["recM4"], "Availability Status": "Maybe", "Player Notes": "Work", "Season (Matches)": "2026-27" } },
];

let fetchCalls: { url: string; method: string }[] = [];

function tableOf(u: string): string {
  return decodeURIComponent((u.match(/\/v0\/[^/]+\/([^/?]+)/) ?? [])[1] ?? "");
}

function installFakeAirtable() {
  const fetchMock = vi.fn((url: any, init?: any) => {
    const u = String(url);
    fetchCalls.push({ url: u, method: init?.method ?? "GET" });
    if (!u.includes("api.airtable.com")) return Promise.resolve(new Response("{}", { status: 404 }));
    const table = tableOf(u);
    let records: any[] = [];
    if (table === "People") {
      records = PLAYER_RECORDS;
      // Honest filterByFormula emulation: {Email}="..."
      const q = new URLSearchParams(u.split("?")[1] ?? "");
      const formula = decodeURIComponent(q.get("filterByFormula") || "");
      const m = formula.match(/"([^"]+)"/);
      if (m) {
        const needle = m[1].toLowerCase();
        records = records.filter((r) => (r.fields?.["Email"] || "").toLowerCase() === needle);
      }
    } else if (table === "Teams") records = TEAM_RECORDS;
    else if (table === "Matches") records = MATCH_RECORDS;
    else if (table === "Availability Exceptions") records = EXCEPTION_RECORDS;
    else records = [];
    const byId = u.match(/\/rec[A-Z0-9]+/);
    if (byId) {
      const found = records.find((r) => u.includes(r.id));
      return Promise.resolve(
        new Response(JSON.stringify(found ?? { id: "x", fields: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ records }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as any;
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  invalidateAll();
  fetchCalls = [];
  installFakeAirtable();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const exceptionFetches = () =>
  fetchCalls.filter((c) => c.method === "GET" && tableOf(c.url) === "Availability Exceptions").length;

describe("getMyFixtures - special goalkeeper view", () => {
  it("returns every upcoming HKFC fixture (one card per match, derbies single)", async () => {
    const out = await getMyFixtures(ENV, authUser("bob@hkfc.com"));
    expect(out.specialGoalkeeperView).toBe(true);
    expect(out.displayTeam).toBe("H"); // banner copy uses the team name, never "lowest ranked"
    expect(out.fixtures.map((f: any) => f.id)).toEqual(["recM1", "recM4"]);
    // Derby A vs B is a single card, not two.
    expect(out.fixtures.filter((f: any) => f.id === "recM4")).toHaveLength(1);
  });

  it("excludes matches with no HKFC side", async () => {
    const out = await getMyFixtures(ENV, authUser("bob@hkfc.com"));
    expect(out.fixtures.some((f: any) => f.id === "recM6")).toBe(false);
  });

  it("sorts by date ascending", async () => {
    const out = await getMyFixtures(ENV, authUser("bob@hkfc.com"));
    const dates = out.fixtures.map((f: any) => f.date);
    expect(dates).toEqual([...dates].sort());
  });

  it("maps selection status from either side", async () => {
    const out = await getMyFixtures(ENV, authUser("bob@hkfc.com"));
    const m1 = out.fixtures.find((f: any) => f.id === "recM1");
    const m4 = out.fixtures.find((f: any) => f.id === "recM4");
    expect(m1.selectionStatus).toBe("Selected");
    // Selected for the away side of the A vs B derby -> card shows that side.
    expect(m4.selectionStatus).toBe("Selected");
    expect(m4.hkfcTeam).toBe("B");
  });

  it("maps per-match availability exceptions (Maybe) and defaults to Available", async () => {
    const out = await getMyFixtures(ENV, authUser("bob@hkfc.com"));
    const m1 = out.fixtures.find((f: any) => f.id === "recM1");
    const m4 = out.fixtures.find((f: any) => f.id === "recM4");
    expect(m1.availabilityStatus).toBe("Available");
    expect(m4.availabilityStatus).toBe("Maybe");
    expect(m4.playerNotes).toBe("Work");
    expect(m4.availabilityExceptionId).toBe("recE1");
  });

  it("fetches exceptions in bulk by season - never once per fixture", async () => {
    await getMyFixtures(ENV, authUser("bob@hkfc.com"));
    expect(exceptionFetches()).toBe(1);
  });

  it("does not change the normal player experience", async () => {
    const out = await getMyFixtures(ENV, authUser("dave@hkfc.com"));
    expect(out.specialGoalkeeperView).toBeUndefined();
    expect(out.fixtures.map((f: any) => f.id)).toEqual(["recM1", "recM4"]);
    expect(out.fixtures.every((f: any) => f.hkfcTeam === "A")).toBe(true);
  });
});
