import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Lowest-ranked-team Goalkeeper schedule (worker/src/fixtures.ts)
// ---------------------------------------------------------------------------

import {
  getLowestRankedTeamName,
  isSpecialGoalkeeper,
  getMyFixtures,
} from "../worker/src/fixtures";
import { invalidateAll } from "../worker/src/cache";
import type { ReferenceData } from "../worker/src/reference";
import type { AuthorizedUser } from "../worker/src/auth";
import { useFakeRepos } from "./helpers/fakeRepos";
import { fakePostgrest, SUPABASE_TEST_ENV } from "./helpers/postgrest";
import { exception, match, person, recId, team } from "./helpers/factories";

function authUser(email: string): AuthorizedUser {
  return { email, personId: "", role: "player", coachTeams: [], isSectionCaptain: false, officerRoles: [] };
}

const ENV = {
  ...SUPABASE_TEST_ENV,
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
// getMyFixtures integration (in-memory repositories, Supabase path)
// ---------------------------------------------------------------------------

const P2 = recId("P2");
const M1 = recId("M1");
const M4 = recId("M4");
const M6 = recId("M6");
const E1 = recId("E1");

const db = useFakeRepos(() => ({
  teams: ["A", "B", "C", "D", "E", "F", "G", "H"].map((n, i) =>
    team({ id: recId(`T${i}`), teamName: n, teamRank: i + 1, active: true, targetSquadSize: 14 }),
  ),
  people: [
    person({
      id: P2, preferredName: "Bob", surname: "B", email: "bob@hkfc.com", active: true, registeredTeam: "H",
      playingPosition: "Goalkeeper", playingAbility: "H", status: "Active",
    }),
    person({
      id: recId("P4"), preferredName: "Dave", surname: "D", email: "dave@hkfc.com", active: true, registeredTeam: "A",
      playingPosition: "Defender", playingAbility: "A", status: "Active",
    }),
  ],
  matches: [
    match({
      id: M1, matchDate: futureIso(3), season: "2026-27", division: "Div 1", homeTeam: "A", awayTeam: "Valley A",
      venue: "P1", matchStatus: "Scheduled", selectedPlayersHome: [P2], selectedPlayersAway: [],
    }),
    match({
      id: M4, matchDate: futureIso(4), season: "2026-27", division: "Div 1", homeTeam: "A", awayTeam: "B",
      venue: "P1", matchStatus: "Scheduled", selectedPlayersHome: [], selectedPlayersAway: [P2],
    }),
    match({
      id: M6, matchDate: futureIso(5), season: "2026-27", division: "Div 5", homeTeam: "Valley B", awayTeam: "Valley C",
      venue: "Other", matchStatus: "Scheduled", selectedPlayersHome: [], selectedPlayersAway: [],
    }),
  ],
  availabilityExceptions: [
    exception({ id: E1, player: [P2], match: [M4], availabilityStatus: "Maybe", note: "Work", season: "2026-27" }),
  ],
}));

beforeEach(() => {
  invalidateAll();
  // The player dashboard also asks Supabase directly whether this player
  // keeps volunteers, events or umpiring duties (volunteerAccess.ts,
  // eventAccess.ts, umpiring.ts). None of them: every table is empty.
  fakePostgrest({
    tables: { api_offices: [], people: [], offices: [], team_people: [], matches: [], umpire_assignments: [] },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const exceptionFetches = () => db.callsTo("availabilityExceptions", "listForSeasons").length;

describe("getMyFixtures - special goalkeeper view", () => {
  it("returns every upcoming HKFC fixture (one card per match, derbies single)", async () => {
    const out = await getMyFixtures(ENV, authUser("bob@hkfc.com"));
    expect(out.specialGoalkeeperView).toBe(true);
    expect(out.displayTeam).toBe("H"); // banner copy uses the team name, never "lowest ranked"
    expect(out.fixtures.map((f: any) => f.id)).toEqual([M1, M4]);
    // Derby A vs B is a single card, not two.
    expect(out.fixtures.filter((f: any) => f.id === M4)).toHaveLength(1);
  });

  it("excludes matches with no HKFC side", async () => {
    const out = await getMyFixtures(ENV, authUser("bob@hkfc.com"));
    expect(out.fixtures.some((f: any) => f.id === M6)).toBe(false);
  });

  it("sorts by date ascending", async () => {
    const out = await getMyFixtures(ENV, authUser("bob@hkfc.com"));
    const dates = out.fixtures.map((f: any) => f.date);
    expect(dates).toEqual([...dates].sort());
  });

  it("maps selection status from either side", async () => {
    const out = await getMyFixtures(ENV, authUser("bob@hkfc.com"));
    const m1 = out.fixtures.find((f: any) => f.id === M1);
    const m4 = out.fixtures.find((f: any) => f.id === M4);
    expect(m1.selectionStatus).toBe("Selected");
    // Selected for the away side of the A vs B derby -> card shows that side.
    expect(m4.selectionStatus).toBe("Selected");
    expect(m4.hkfcTeam).toBe("B");
  });

  it("maps per-match availability exceptions (Maybe) and defaults to Available", async () => {
    const out = await getMyFixtures(ENV, authUser("bob@hkfc.com"));
    const m1 = out.fixtures.find((f: any) => f.id === M1);
    const m4 = out.fixtures.find((f: any) => f.id === M4);
    expect(m1.availabilityStatus).toBe("Available");
    expect(m4.availabilityStatus).toBe("Maybe");
    expect(m4.playerNotes).toBe("Work");
    expect(m4.availabilityExceptionId).toBe(E1);
  });

  it("fetches exceptions in bulk by season - never once per fixture", async () => {
    await getMyFixtures(ENV, authUser("bob@hkfc.com"));
    expect(exceptionFetches()).toBe(1);
  });

  it("does not change the normal player experience", async () => {
    const out = await getMyFixtures(ENV, authUser("dave@hkfc.com"));
    expect(out.specialGoalkeeperView).toBeUndefined();
    expect(out.fixtures.map((f: any) => f.id)).toEqual([M1, M4]);
    expect(out.fixtures.every((f: any) => f.hkfcTeam === "A")).toBe(true);
  });
});
