import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Derby side resolution (worker/src/squad.ts :: resolveHkfcSide), through
// getPlayersForMatch.
//
// On a derby both sides are HKFC teams, so `?side=` is the only thing that
// says whose squad is wanted. Regression for the derby bug: a read that
// ignored the side showed the away team the home squad. These assertions
// used to sit on getSquadForMatch, which was removed with its unused route.
// The reads run on the in-memory repositories.
// ---------------------------------------------------------------------------

import { getPlayersForMatch } from "../worker/src/squad";
import { invalidateAll } from "../worker/src/cache";
import type { Env } from "../worker/src/env";
import { useFakeRepos } from "./helpers/fakeRepos";
import { fakePostgrest, SUPABASE_TEST_ENV } from "./helpers/postgrest";
import { match, person, recId, team } from "./helpers/factories";

const ENV = {
  ...SUPABASE_TEST_ENV,
  CALENDAR_SECRET: "***",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as unknown as Env;

const HOME = recId("Home");
const AWAY = recId("Away");
const DERBY = recId("Derby");

useFakeRepos(() => ({
  teams: [
    team({ id: recId("TB"), teamName: "HKFC B", teamRank: 2, active: true }),
    team({ id: recId("TC"), teamName: "HKFC C", teamRank: 3, active: true }),
  ],
  people: [
    person({ id: HOME, preferredName: "Homer", active: true, registeredTeam: "HKFC B", playingPosition: "Defender" }),
    person({ id: AWAY, preferredName: "Awena", active: true, registeredTeam: "HKFC C", playingPosition: "Forward" }),
  ],
  matches: [
    match({
      id: DERBY,
      matchDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      season: "2026-2027",
      homeTeam: "HKFC B",
      awayTeam: "HKFC C",
      matchStatus: "Scheduled",
      selectedPlayersHome: [HOME],
      selectedPlayersAway: [AWAY],
    }),
  ],
}));

beforeEach(() => {
  invalidateAll();
  // Nothing here should query PostgREST directly; a request that did would fail the test.
  fakePostgrest({ tables: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function selectedIds(side: "home" | "away") {
  const result = await getPlayersForMatch(ENV, DERBY, side);
  return {
    team: result.match.hkfcTeam,
    selected: result.players.filter((p) => p.selectionStatus === "Selected").map((p) => p.id),
  };
}

describe("getPlayersForMatch on a derby", () => {
  it("reads the home squad for side=home", async () => {
    expect(await selectedIds("home")).toEqual({ team: "HKFC B", selected: [HOME] });
  });

  it("reads the away squad for side=away", async () => {
    expect(await selectedIds("away")).toEqual({ team: "HKFC C", selected: [AWAY] });
  });
});
