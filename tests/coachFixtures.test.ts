import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Coach Dashboard fixture tiles: Maybe/Unavailable counts and name lists only
// consider players whose SELECTED (display) team is the fixture's team.
// Cross-team eligible players' marks belong to their own team's tile.
// The recommendation/selection engine is not involved in these counts.
//
// Runs on the Supabase path: the in-memory repositories (tests/helpers/fakeRepos.ts).
// ---------------------------------------------------------------------------

import { getUpcomingFixtures } from "../worker/src/fixtures";
import { invalidateAll } from "../worker/src/cache";
import type { Env } from "../worker/src/env";
import { useFakeRepos } from "./helpers/fakeRepos";
import { SUPABASE_TEST_ENV } from "./helpers/postgrest";
import { exception, match, person, recId, team } from "./helpers/factories";

const ENV = { ...SUPABASE_TEST_ENV } as unknown as Env;

const DAY1 = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0];

const JONNY = recId("Jonny");
const TOM = recId("Tom");
const HARRY = recId("Harry");
const M_E = recId("MatchE");
const M_F = recId("MatchF");
const M_EF = recId("MatchEF");
const M_LASTWEEK = recId("MatchLastWeek");
const M_ANCIENT = recId("MatchAncient");
const M_EARLIER_TODAY = recId("MatchEarlierToday");

/** A scheduled home fixture for `team` against an outside club, 2026-27. */
const fixture = (id: string, homeTeam: string, matchDate: string, overrides: Parameters<typeof match>[0] = {}) =>
  match({ id, matchDate, season: "2026-2027", homeTeam, awayTeam: "Opponent", matchStatus: "Scheduled", ...overrides });

/** An availability answer for 2026-27. */
const mark = (playerId: string, matchId: string, availabilityStatus: "Maybe" | "Unavailable") =>
  exception({ player: [playerId], match: [matchId], availabilityStatus, season: "2026-2027" });

const db = useFakeRepos(() => ({
  teams: ["A", "B", "C", "D", "E", "F"].map((n, i) => team({ teamName: n, teamRank: i + 1, active: true })),
  // Jonny: registered F but Selected Team EOS = E -> displayed as an E player.
  // Tom:   registered E -> displayed as an E player.
  // Harry: registered F -> displayed as an F player.
  people: [
    person({ id: JONNY, preferredName: "Jonny", email: "a@hkfc.com", active: true, registeredTeam: "F", selectedTeamEos: "E", playingPosition: "Forward", playingAbility: "A" }),
    person({ id: TOM, preferredName: "Tom", email: "b@hkfc.com", active: true, registeredTeam: "E", playingPosition: "Midfielder", playingAbility: "B" }),
    person({ id: HARRY, preferredName: "Harry", email: "c@hkfc.com", active: true, registeredTeam: "F", playingPosition: "Defender", playingAbility: "B" }),
  ],
  matches: [
    fixture(M_E, "E", `${DAY1}T09:00:00.000Z`),
    fixture(M_F, "F", `${DAY1}T11:00:00.000Z`),
  ],
  availabilityExceptions: [
    // Jonny (display E): Maybe for the E fixture, Unavailable for the F fixture.
    mark(JONNY, M_E, "Maybe"),
    mark(JONNY, M_F, "Unavailable"),
    // Tom (display E): Maybe for the E fixture.
    mark(TOM, M_E, "Maybe"),
    // Harry (display F): Unavailable for the F fixture.
    mark(HARRY, M_F, "Unavailable"),
  ],
}));

beforeEach(() => {
  invalidateAll();
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
    db.state.matches.push(
      fixture(M_EF, "E", `${new Date(Date.now() + 9 * 86_400_000).toISOString().split("T")[0]}T10:00:00.000Z`, { awayTeam: "F" }),
    );
    db.state.availabilityExceptions.push(
      mark(JONNY, M_EF, "Maybe"),
      mark(HARRY, M_EF, "Unavailable"),
    );
    const eTile = (await (async () => {
      const { fixtures } = await getUpcomingFixtures(ENV, { team: "E" });
      return fixtures.find((f: any) => f.id === M_EF);
    })());
    const fTile = (await (async () => {
      const { fixtures } = await getUpcomingFixtures(ENV, { team: "F" });
      return fixtures.find((f: any) => f.id === M_EF);
    })());
    // E side card: Jonny (display E). F side card: Harry (display F).
    expect(eTile?.maybeNames).toEqual(["Jonny"]);
    expect(eTile?.unavailableNames ?? []).toHaveLength(0);
    expect(fTile?.unavailableNames).toEqual(["Harry"]);
    expect(fTile?.maybeNames ?? []).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// "Show past" on the coach fixture list. A fixture leaves the "Scheduled"
// status the moment a result is entered, so the query behind this screen
// could not see last weekend's games however the client filtered by date.
// The toggle looked broken because the matches were never fetched.
// ---------------------------------------------------------------------------

describe("coach fixture list: recently played matches", () => {
  const dayOffset = (days: number) =>
    new Date(Date.now() + days * 86_400_000).toISOString().split("T")[0];

  const addMatch = (id: string, team: string, day: string, status: string) => {
    db.state.matches.push(fixture(id, team, `${day}T09:00:00.000Z`, { matchStatus: status }));
  };

  const idsFor = async (team: string, includePast?: boolean) => {
    const { fixtures } = await getUpcomingFixtures(ENV, { team, includePast });
    return fixtures.map((f: { id: string }) => f.id);
  };

  it("omits a played match by default, so the normal list stays upcoming-only", async () => {
    addMatch(M_LASTWEEK, "E", dayOffset(-3), "Played");
    expect(await idsFor("E")).not.toContain(M_LASTWEEK);
  });

  it("includes last weekend's played match when past fixtures are asked for", async () => {
    addMatch(M_LASTWEEK, "E", dayOffset(-3), "Played");
    expect(await idsFor("E", true)).toContain(M_LASTWEEK);
  });

  it("still returns upcoming fixtures alongside the past ones", async () => {
    addMatch(M_LASTWEEK, "E", dayOffset(-3), "Played");
    const ids = await idsFor("E", true);
    expect(ids).toContain(M_E);
    expect(ids).toContain(M_LASTWEEK);
  });

  it("stops at the window, so the list cannot grow without bound", async () => {
    addMatch(M_ANCIENT, "E", dayOffset(-120), "Played");
    expect(await idsFor("E", true)).not.toContain(M_ANCIENT);
  });

  // Regression: the filter compared against the current instant, so a fixture
  // vanished from the coach's list the moment it kicked off - exactly when the
  // teamsheet is wanted. Today's fixtures now stay all day.
  //
  // Pinned to a fixed clock rather than "today at 09:00", which would only
  // exercise the regression when the suite happened to run after kick-off.
  it("keeps a fixture earlier today in the upcoming list", async () => {
    vi.useFakeTimers();
    try {
      // 18:00 Hong Kong, with the fixture at 17:00 the same day: already
      // started, still today, so it must stay on the list.
      vi.setSystemTime(new Date("2026-09-10T10:00:00.000Z"));
      db.state.matches.push(fixture(M_EARLIER_TODAY, "E", "2026-09-10T09:00:00.000Z"));
      expect(await idsFor("E")).toContain(M_EARLIER_TODAY);
    } finally {
      vi.useRealTimers();
    }
  });
});
