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
import type { Match } from "../shared/schema/domainTypes";
import { useFakeRepos } from "./helpers/fakeRepos";
import { fakePostgrest, SUPABASE_TEST_ENV } from "./helpers/postgrest";
import { match, person, recId, team } from "./helpers/factories";

const ENV = {
  ...SUPABASE_TEST_ENV,
  CALENDAR_SECRET: "***",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

const DAY = "2026-09-26";

// Already full-length row ids, so isRowId() on the save path accepts them.
const UMA = "recU21PlayerAAAAA";
const SAM = "recSamPlayerAAAAA";
const KIM = "recKimPlayerAAAAA";
const LOW = recId("Low");
const HIGH = recId("High");

function player(id: string, name: string, registeredTeam: string, extra: Parameters<typeof person>[0] = {}) {
  return person({
    id, preferredName: name, surname: "S", email: `${id}@hkfc.com`, active: true, status: "Active",
    registeredTeam, playingPosition: "Midfielder", playingAbility: "C", ...extra,
  });
}

function fixture(id: string, homeTeam: string, selected: string[], extra: Partial<Match> = {}) {
  return match({
    id, matchDate: `${DAY}T02:00:00.000Z`, season: "2026-27", division: "Div 3", homeTeam, awayTeam: `Opp ${id}`,
    venue: "P1", matchStatus: "Scheduled", selectedPlayersHome: selected, selectedPlayersAway: [], ...extra,
  });
}

const db = useFakeRepos();

function install(matches: Match[]) {
  db.reset({
    teams: ["HKFC A", "HKFC B", "HKFC C", "HKFC D", "HKFC E"].map((n, i) =>
      team({ id: recId(`T${i}`), teamName: n, teamRank: i + 1, active: true, targetSquadSize: 14 }),
    ),
    people: [
      player(UMA, "Uma", "HKFC D", { u21Eligible: true }),
      player(SAM, "Sam", "HKFC D"),
      player(KIM, "Kim", "HKFC D"),
    ],
    matches,
  });
}

const selected = (matchId: string) => db.state.matches.find((m) => m.id === matchId)?.selectedPlayersHome;

beforeEach(() => {
  invalidateAll();
  // Nothing here should reach Supabase directly; any request fails the test.
  fakePostgrest({ tables: {} });
});
afterEach(() => vi.unstubAllGlobals());

describe("syncSquad: higher team priority", () => {
  it("takes a U21 out of their own team's squad when a higher team picks them", async () => {
    install([fixture(LOW, "HKFC D", [UMA, KIM]), fixture(HIGH, "HKFC B", [])]);

    const { displaced } = await syncSquad(ENV, HIGH, [UMA], "coach@hkfc.com", "home");

    expect(selected(HIGH)).toEqual([UMA]);
    expect(selected(LOW)).toEqual([KIM]);
    expect(displaced).toEqual([{ playerId: UMA, playerName: "Uma S", team: "HKFC D", matchId: LOW }]);
  });

  it("does the same for any player, not only U21s", async () => {
    install([fixture(LOW, "HKFC D", [SAM]), fixture(HIGH, "HKFC B", [])]);

    const { displaced } = await syncSquad(ENV, HIGH, [SAM], "coach@hkfc.com", "home");

    expect(selected(LOW)).toEqual([]);
    expect(displaced.map((d) => d.playerId)).toEqual([SAM]);
  });

  it("leaves players already in the squad where they are (only new picks move)", async () => {
    // Re-saving a squad must not keep reaching into other squads.
    install([fixture(LOW, "HKFC D", [KIM]), fixture(HIGH, "HKFC B", [SAM])]);

    const { displaced } = await syncSquad(ENV, HIGH, [SAM], "coach@hkfc.com", "home");

    expect(displaced).toEqual([]);
    expect(selected(LOW)).toEqual([KIM]);
  });

  it("does not rewrite a lower squad whose match has been played", async () => {
    install([
      fixture(LOW, "HKFC D", [SAM], { matchStatus: "Played" }),
      fixture(HIGH, "HKFC B", []),
    ]);

    const { displaced } = await syncSquad(ENV, HIGH, [SAM], "coach@hkfc.com", "home");

    expect(displaced).toEqual([]);
    expect(selected(LOW)).toEqual([SAM]);
  });

  it("still rejects the reverse: a lower team cannot take a player a higher team has", async () => {
    install([fixture(LOW, "HKFC D", []), fixture(HIGH, "HKFC B", [UMA])]);

    await expect(syncSquad(ENV, LOW, [UMA], "coach@hkfc.com", "home")).rejects.toThrow(
      /Selected for HKFC B on same day/,
    );
    expect(selected(HIGH)).toEqual([UMA]);
  });
});
