import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Squad saves as changes (Track B6, POST /api/squad/changes).
//
// A save sends only who was added and removed, plus the squad version the
// page loaded. Runs on the in-memory repositories; the write
// (apply_squad_changes) is the fake matches repo's applySelectionChanges.
// ---------------------------------------------------------------------------

import { applySquadChanges, getPlayersForMatch, parseSquadChanges } from "../worker/src/squad";
import { supabaseMatches } from "../worker/src/data/supabase/squad";
import { toMatch, type MatchRow } from "../worker/src/data/supabase/mappers";
import { invalidateAll } from "../worker/src/cache";
import { HttpError } from "../worker/src/http";
import type { Match } from "../shared/schema/domainTypes";
import type { Env } from "../worker/src/env";
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
const UMA = "recU21PlayerAAAAA";
const SAM = "recSamPlayerAAAAA";
const KIM = "recKimPlayerAAAAA";
const LOW = recId("Low");
const HIGH = recId("High");
const COACH = { email: "coach@hkfc.com", personId: "recCoachPersonAAA" };

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
const changes = () => db.callsTo("matches", "applySelectionChanges").map((c) => c.args);

beforeEach(() => {
  invalidateAll();
  // Nothing here should reach Supabase directly; any request fails the test.
  fakePostgrest({ tables: {} });
});
afterEach(() => vi.unstubAllGlobals());

describe("applySquadChanges", () => {
  it("sends only the changes, the loaded version and the session's person to apply_squad_changes", async () => {
    install([fixture(HIGH, "HKFC B", [KIM])]);

    const out = await applySquadChanges(ENV, { matchId: HIGH, add: [SAM], remove: [KIM], version: 0 }, COACH);

    expect(changes()).toEqual([[
      HIGH, { side: "home", add: [SAM], remove: [KIM], version: 0, actorId: COACH.personId, source: "coach" },
    ]]);
    expect(out).toEqual({ status: "ok", version: 1, selectedIds: [SAM], displaced: [] });
    expect(selected(HIGH)).toEqual([SAM]);
  });

  it("does not re-check players the squad already has", async () => {
    // Uma is in both squads (picked before the same-day rule); re-sending her
    // as an add must not be refused.
    install([fixture(LOW, "HKFC D", [UMA]), fixture(HIGH, "HKFC B", [UMA])]);

    const out = await applySquadChanges(ENV, { matchId: LOW, add: [UMA], remove: [], version: 0 }, COACH);

    expect(out.status).toBe("ok");
    expect(changes()).toHaveLength(1);
  });

  it("refuses a new add that is not eligible with 422, writing nothing", async () => {
    install([fixture(LOW, "HKFC D", []), fixture(HIGH, "HKFC B", [UMA])]);

    const err = await applySquadChanges(ENV, { matchId: LOW, add: [UMA], remove: [], version: 0 }, COACH).catch((e) => e);

    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(422);
    expect(err.message).toMatch(/Selected for HKFC B on same day/);
    expect(changes()).toEqual([]);
  });

  it("releases a higher team's new pick from a same-day lower squad through apply_squad_changes", async () => {
    install([fixture(LOW, "HKFC D", [SAM, KIM]), fixture(HIGH, "HKFC B", [])]);

    const out = await applySquadChanges(ENV, { matchId: HIGH, add: [SAM], remove: [], version: 0 }, COACH);

    expect(changes()[1]).toEqual([
      LOW, { side: "home", add: [], remove: [SAM], version: null, actorId: COACH.personId, source: "release" },
    ]);
    expect(out.status === "ok" && out.displaced).toEqual([{ playerId: SAM, playerName: "Sam S", team: "HKFC D", matchId: LOW }]);
    expect(selected(LOW)).toEqual([KIM]);
  });

  it("returns a conflict naming the players, and releases nothing", async () => {
    install([fixture(LOW, "HKFC D", [SAM, KIM]), fixture(HIGH, "HKFC B", [KIM])]);
    vi.spyOn(db.repos.matches, "applySelectionChanges")
      .mockResolvedValue({ status: "conflict", version: 5, players: [KIM], selected: [KIM] });

    const out = await applySquadChanges(ENV, { matchId: HIGH, add: [SAM], remove: [KIM], version: 2 }, COACH);

    expect(out).toEqual({ status: "conflict", version: 5, selectedIds: [KIM], players: [{ id: KIM, name: "Kim S" }] });
    expect(db.repos.matches.applySelectionChanges).toHaveBeenCalledTimes(1);
    expect(selected(LOW)).toEqual([SAM, KIM]);
  });
});

describe("parseSquadChanges", () => {
  const ok = { matchId: HIGH, add: [SAM], remove: [KIM], version: 0 };
  const many = Array.from({ length: 41 }, (_, i) => `recPlayer${String(i).padStart(8, "0")}`);

  it("accepts a well-formed body, dropping repeated ids", () => {
    expect(parseSquadChanges({ ...ok, add: [SAM, SAM], side: "away" })).toEqual({
      matchId: HIGH, side: "away", add: [SAM], remove: [KIM], version: 0,
    });
  });

  it.each([
    ["a bad match id", { ...ok, matchId: "not-an-id" }],
    ["an unknown side", { ...ok, side: "both" }],
    ["adds that are not a list", { ...ok, add: SAM }],
    ["more than 40 adds", { ...ok, add: many }],
    ["more than 40 removes", { ...ok, add: [], remove: many }],
    ["an invalid player id", { ...ok, remove: ["robert'); drop"] }],
    ["the same player added and removed", { ...ok, remove: [SAM] }],
    ["no version", { matchId: HIGH, add: [SAM] }],
    ["a negative version", { ...ok, version: -1 }],
    ["a fractional version", { ...ok, version: 1.5 }],
    ["a version as text", { ...ok, version: "3" }],
  ])("refuses %s with 400", (_label, body) => {
    expect(() => parseSquadChanges(body)).toThrow(expect.objectContaining({ status: 400 }));
  });
});

describe("the squad version on the squad page", () => {
  it("comes from the same match record as the selected players, per side", async () => {
    install([fixture(HIGH, "HKFC B", [KIM], { selectionVersionHome: 4, selectionVersionAway: 9 })]);

    const { match: info } = await getPlayersForMatch(ENV, HIGH, "home");

    expect(info.selectionVersion).toBe(4);
    expect(info.selectedCount).toBe(1);
  });

  it("is 0 before the squad's first change", async () => {
    install([fixture(HIGH, "HKFC B", [])]);
    const { match: info } = await getPlayersForMatch(ENV, HIGH, "home");
    expect(info.selectionVersion).toBe(0);
  });
});

describe("Supabase: apply_squad_changes", () => {
  const env = { ...SUPABASE_TEST_ENV } as Env;

  function rpc(response: unknown) {
    const calls: unknown[] = [];
    fakePostgrest({ rpc: { apply_squad_changes: (args) => { calls.push(args); return response; } } });
    return calls;
  }

  it("is one rpc with the change, the version, the actor and the source", async () => {
    const calls = rpc({ status: "ok", version: 2, otherVersion: null, added: ["recA"], removed: [], selected: ["recA"] });

    const r = await supabaseMatches(env).applySelectionChanges("recM1", {
      side: "away", add: ["recA"], remove: ["recB"], version: 1, actorId: "recCoach", source: "coach",
    });

    expect(calls).toEqual([{
      p_match: "recM1", p_side: "away", p_add: ["recA"], p_remove: ["recB"], p_version: 1, p_actor: "recCoach", p_source: "coach",
    }]);
    expect(r).toEqual({ status: "ok", version: 2, otherVersion: null, added: ["recA"], removed: [], selected: ["recA"] });
  });

  it("sends a release with no version and no actor as nulls", async () => {
    const calls = rpc({ status: "unchanged", version: 4, selected: [] });

    await supabaseMatches(env).applySelectionChanges("recM1", { side: "home", add: [], remove: ["recB"], version: null, source: "release" });

    expect(calls[0]).toMatchObject({ p_version: null, p_actor: null, p_source: "release" });
  });

  it("reads each side's version off api_matches", () => {
    const row = { id: "recM1", selected_players_home: [], selected_players_away: [], selection_version_home: 3, selection_version_away: 1 } as unknown as MatchRow;
    expect(toMatch(row)).toMatchObject({ selectionVersionHome: 3, selectionVersionAway: 1 });
  });
});
