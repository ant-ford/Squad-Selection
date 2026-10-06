import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMyFixtures, getPlayerFixtures } from "../worker/src/fixtures";
import { invalidateAll } from "../worker/src/cache";
import { newRequestStats, noteRequestVersions, runWithRequestContext } from "../worker/src/requestContext";
import { parseCacheVersions } from "../worker/src/cacheVersions";
import { currentSeason } from "../worker/src/seasonContext";
import type { Env } from "../worker/src/env";
import { fakePostgrest, SUPABASE_TEST_ENV, type FakePostgrest } from "./helpers/postgrest";
import { signedIn } from "./helpers/factories";

/**
 * Cold my-fixtures used to read one thing after another (reference data,
 * then the scheduled matches, then the season context, then the rules and
 * the player's answers): on preview, 6 calls one after another, ~1.6 s of
 * waiting. Now the view asks for everything at once. This holds every
 * database response until the test releases the whole "wave" of requests
 * in flight, and counts the waves: the number of round trips in a row.
 */

const SEASON = currentSeason();
const ME = "recMe000000000000";
const MATE = "recMate0000000000";
const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const teamRow = (n: string, rank: number) => ({
  id: `recT${n}00000000000`, team_name: `HKFC ${n}`, team_rank: rank, is_premier: rank === 1, target_squad_size: 16, active: true,
  coach: [], team_captain: [], section_captain: [], auto_select_players: [],
});
const playerRow = (id: string, team: string) => ({
  id, preferred_name: id.slice(3, 7), given_names: null, surname: null, shirt_no_value: null, email: null, mobile_no: null, active: true,
  registered_team: team, selected_team_sos: null, selected_team_eos: null, playing_position: "Defender", playing_ability: null,
  is_visiting_player: false, is_suspended: false, matches_to_serve: null, ever_registered_to_premier: false, u21_eligible: false,
  section_rank: null, status: "Member", applicant_stage: null, opt_in_only: false, birthday: null,
});
const matchRow = (id: string, date: string, home: string, selected: string[]) => ({
  id, match_date: date, season: SEASON, division: "2", competition_type: "LEAGUE", home_team: home, home_score: null,
  away_team: "Valley A", away_score: null, match_status: "Scheduled", venue: "HKFC", fixture_id: null,
  selected_players_home: selected, selected_players_away: [], auto_select_enabled: false, home_kit: null, away_kit: null,
  ump_1: null, ump_2: null,
});
const MATCHES = [matchRow("recM1000000000000", soon(3), "HKFC C", [ME, MATE]), matchRow("recM2000000000000", soon(3), "HKFC B", [])];

/** season_context's answer for the player: the matches, and their own answer (with note and id) plus a selected mate's. */
const seasonContext = {
  v: 1, season: SEASON, prev: "", people: [MATE, ME],
  matches: MATCHES.map((m) => [m.id, m.match_date, "2", "LEAGUE", m.home_team, "Valley A", "Scheduled", null, null, "HKFC",
    m.selected_players_home.map((id) => (id === MATE ? 0 : 1)), [], [], 0]),
  cards: [], prevMatches: [], prevCards: [], suspensions: [],
  exceptions: [[1, 0, "M", "Late", "recAns1"], [0, 0, "U", null, null]],
};

let pg: FakePostgrest;
let held: (() => void)[] = [];
beforeEach(() => {
  invalidateAll();
  held = [];
  pg = fakePostgrest({
    tables: {
      api_players_lite: [playerRow(ME, "HKFC C"), playerRow(MATE, "HKFC C")],
      api_teams: [teamRow("A", 1), teamRow("B", 2), teamRow("C", 3)],
      api_matches: MATCHES,
      api_availability_rules: [],
    },
    rpc: { season_context: () => seasonContext },
  });
  // Hold every response until the test releases the wave it belongs to.
  const answer = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => held.push(() => answer(input, init).then(resolve, reject))));
});
afterEach(() => vi.unstubAllGlobals());

/** Runs `work` as a signed-in request; returns its result and how many waves of database calls it made in a row. */
async function waves<T>(work: () => Promise<T>): Promise<{ result: T; waves: number[] }> {
  const sizes: number[] = [];
  let done = false;
  const run = runWithRequestContext({ stats: newRequestStats() }, async () => {
    noteRequestVersions(parseCacheVersions({ matches: 1 })); // as sign-in (auth_context) leaves them
    return work();
  }).finally(() => {
    done = true;
  });
  for (let guard = 0; guard < 50 && !done; guard++) {
    // Let everything that can start, start.
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    if (held.length > 0) {
      sizes.push(held.length);
      const wave = held;
      held = [];
      for (const release of wave) release();
    }
  }
  return { result: await run, waves: sizes };
}

const me = () => signedIn({ email: "me@hkfc.com", personId: ME, personUuid: "uuid-me", person: { id: ME, uuid: "uuid-me", registeredTeam: "HKFC C", active: true } });

describe("cold my-fixtures", () => {
  it("asks for everything in one wave: players, teams, scheduled matches, the season context, the rules", async () => {
    const { result, waves: w } = await waves(() => getMyFixtures(env, me()));
    expect(w).toEqual([5]);
    expect(pg.calls.map((c) => c.table).sort()).toEqual(
      ["api_availability_rules", "api_matches", "api_players_lite", "api_teams", "rpc/season_context"].sort(),
    );
    // The player's own answer, note and id, came from the season context: no read of their own.
    const card = result.fixtures.find((f: any) => f.id === "recM1000000000000");
    expect(card).toMatchObject({ availabilityStatus: "Maybe", playerNotes: "Late", availabilityExceptionId: "recAns1" });
    expect(pg.calls.some((c) => c.table === "api_availability_exceptions")).toBe(false);
  });

  it("with past results too: still one wave", async () => {
    const { waves: w } = await waves(() => getMyFixtures(env, me(), { includePast: true }));
    expect(w).toEqual([5]);
  });

  it("warm (same versions): no database call at all", async () => {
    await waves(() => getMyFixtures(env, me()));
    const callsBefore = pg.calls.length;
    const { waves: w } = await waves(() => getMyFixtures(env, me()));
    expect(w).toEqual([]);
    expect(pg.calls.length).toBe(callsBefore);
  });
});

describe("the calendar feed's fixtures", () => {
  it("one wave as well, with the squad's answers from the same context", async () => {
    const { result, waves: w } = await waves(() => getPlayerFixtures(env, ME));
    expect(w).toEqual([5]);
    const card = result.fixtures.find((f: any) => f.id === "recM1000000000000");
    expect(card.squad.map((s: any) => s.availabilityStatus).sort()).toEqual(["Maybe", "Unavailable"]);
  });
});

const env = { ...SUPABASE_TEST_ENV, API_ORIGIN: "https://api.test", FILE_SIGNING_KEY: "k" } as unknown as Env;
