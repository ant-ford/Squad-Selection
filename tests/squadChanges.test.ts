import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Squad saves as changes (Track B6, POST /api/squad/changes).
//
// A save sends only who was added and removed, plus the squad version the
// page loaded. Reads run on the fake Airtable tables; the write
// (apply_squad_changes, Supabase only) is recorded and applied to the fake.
// ---------------------------------------------------------------------------

import { applySquadChanges, getPlayersForMatch, parseSquadChanges } from "../worker/src/squad";
import { supabaseMatches } from "../worker/src/data/supabase/squad";
import { toMatch, type MatchRow } from "../worker/src/data/supabase/mappers";
import { invalidateAll } from "../worker/src/cache";
import { HttpError } from "../worker/src/http";
import { fakeAirtable, type FakeTables } from "./helpers/airtable";
import { applyToFakeTables } from "./helpers/selectionChanges";
import type { SelectionChange, SelectionChangeResult } from "../worker/src/data/matches";
import type { Env } from "../worker/src/env";

const state = vi.hoisted(() => ({
  calls: [] as { matchId: string; change: SelectionChange }[],
  respond: null as null | ((matchId: string, change: SelectionChange) => SelectionChangeResult),
  versions: {} as Record<string, { home?: number; away?: number }>,
}));
vi.mock("../worker/src/data/matches", async (importOriginal) => {
  const real = await importOriginal<typeof import("../worker/src/data/matches")>();
  return {
    ...real,
    matches: (env: any) => {
      const repo = real.matches(env);
      return {
        ...repo,
        async getById(id: string) {
          const m = await repo.getById(id);
          return m && { ...m, selectionVersionHome: state.versions[id]?.home, selectionVersionAway: state.versions[id]?.away };
        },
        applySelectionChanges: async (matchId: string, change: SelectionChange) => {
          state.calls.push({ matchId, change });
          return state.respond ? state.respond(matchId, change) : applyToFakeTables(tables, matchId, change);
        },
      };
    },
  };
});

const ENV = {
  AIRTABLE_TOKEN: "***",
  AIRTABLE_BASE_ID: "test-base",
  CALENDAR_SECRET: "***",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

const DAY = "2026-09-26";
const LOW = "recLowMatchAAAAAA";
const HIGH = "recHighMatchAAAAA";
const UMA = "recU21PlayerAAAAA";
const SAM = "recSamPlayerAAAAA";
const KIM = "recKimPlayerAAAAA";
const COACH = { email: "coach@hkfc.com", personId: "recCoachPersonAAA" };

function person(id: string, name: string, team: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    fields: {
      "Preferred Name": name, Surname: "S", Email: `${id}@hkfc.com`, Active: true, Status: "Active",
      "Registered Team": team, "Playing Position": "Midfielder", "Playing Ability": "C", ...extra,
    },
  };
}

function fixture(id: string, home: string, selected: string[]) {
  return {
    id,
    fields: {
      Date: `${DAY}T02:00:00.000Z`, Season: "2026-27", Division: "Div 3", "Home Team": home, "Away Team": `Opp ${id}`,
      Venue: "P1", "Match Status": "Scheduled", "Selected Players Home": selected, "Selected Players Away": [],
    },
  };
}

let tables: FakeTables;

function install(matches: ReturnType<typeof fixture>[]) {
  tables = {
    Teams: ["HKFC A", "HKFC B", "HKFC C", "HKFC D", "HKFC E"].map((n, i) => ({
      id: `recT${i}`, fields: { "Team Name": n, "Team Rank": i + 1, Active: true, "Target Squad Size": 14 },
    })),
    People: [
      person(UMA, "Uma", "HKFC D", { "U21 Eligible": true }),
      person(SAM, "Sam", "HKFC D"),
      person(KIM, "Kim", "HKFC D"),
    ],
    Matches: matches,
  };
  fakeAirtable(tables);
}

const selected = (matchId: string) => tables.Matches.find((r) => r.id === matchId)?.fields["Selected Players Home"];

beforeEach(() => {
  invalidateAll();
  state.calls = [];
  state.respond = null;
  state.versions = {};
});
afterEach(() => vi.unstubAllGlobals());

describe("applySquadChanges", () => {
  it("sends only the changes, the loaded version and the session's person to apply_squad_changes", async () => {
    install([fixture(HIGH, "HKFC B", [KIM])]);

    const out = await applySquadChanges(ENV, { matchId: HIGH, add: [SAM], remove: [KIM], version: 3 }, COACH);

    expect(state.calls).toEqual([{
      matchId: HIGH,
      change: { side: "home", add: [SAM], remove: [KIM], version: 3, actorId: COACH.personId, source: "coach" },
    }]);
    expect(out).toEqual({ status: "ok", version: 1, selectedIds: [SAM], displaced: [] });
    expect(selected(HIGH)).toEqual([SAM]);
  });

  it("does not re-check players the squad already has", async () => {
    // Uma is in both squads (picked before the same-day rule); re-sending her
    // as an add must not be refused.
    install([fixture(LOW, "HKFC D", [UMA]), fixture(HIGH, "HKFC B", [UMA])]);

    const out = await applySquadChanges(ENV, { matchId: LOW, add: [UMA], remove: [], version: 0 }, COACH);

    expect(out.status).toBe("ok");
    expect(state.calls).toHaveLength(1);
  });

  it("refuses a new add that is not eligible with 422, writing nothing", async () => {
    install([fixture(LOW, "HKFC D", []), fixture(HIGH, "HKFC B", [UMA])]);

    const err = await applySquadChanges(ENV, { matchId: LOW, add: [UMA], remove: [], version: 0 }, COACH).catch((e) => e);

    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(422);
    expect(err.message).toMatch(/Selected for HKFC B on same day/);
    expect(state.calls).toEqual([]);
  });

  it("releases a higher team's new pick from a same-day lower squad through apply_squad_changes", async () => {
    install([fixture(LOW, "HKFC D", [SAM, KIM]), fixture(HIGH, "HKFC B", [])]);

    const out = await applySquadChanges(ENV, { matchId: HIGH, add: [SAM], remove: [], version: 0 }, COACH);

    expect(state.calls[1]).toEqual({
      matchId: LOW,
      change: { side: "home", add: [], remove: [SAM], version: null, actorId: COACH.personId, source: "release" },
    });
    expect(out.status === "ok" && out.displaced).toEqual([{ playerId: SAM, playerName: "Sam S", team: "HKFC D", matchId: LOW }]);
    expect(selected(LOW)).toEqual([KIM]);
  });

  it("returns a conflict naming the players, and releases nothing", async () => {
    install([fixture(LOW, "HKFC D", [SAM, KIM]), fixture(HIGH, "HKFC B", [KIM])]);
    state.respond = () => ({ status: "conflict", version: 5, players: [KIM], selected: [KIM] });

    const out = await applySquadChanges(ENV, { matchId: HIGH, add: [SAM], remove: [KIM], version: 2 }, COACH);

    expect(out).toEqual({ status: "conflict", version: 5, selectedIds: [KIM], players: [{ id: KIM, name: "Kim S" }] });
    expect(state.calls).toHaveLength(1);
    expect(selected(LOW)).toEqual([SAM, KIM]);
  });
});

describe("parseSquadChanges", () => {
  const ok = { matchId: HIGH, add: [SAM], remove: [KIM], version: 0 };
  const many = Array.from({ length: 41 }, (_, i) => `recPlayer${String(i).padStart(8, "0")}`);

  it("accepts a well-formed body, dropping repeated ids", () => {
    expect(parseSquadChanges(ENV, { ...ok, add: [SAM, SAM], side: "away" })).toEqual({
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
    expect(() => parseSquadChanges(ENV, body)).toThrow(expect.objectContaining({ status: 400 }));
  });
});

describe("the squad version on the squad page", () => {
  it("comes from the same match record as the selected players, per side", async () => {
    install([fixture(HIGH, "HKFC B", [KIM])]);
    state.versions[HIGH] = { home: 4, away: 9 };

    const { match } = await getPlayersForMatch(ENV, HIGH, "home");

    expect(match.selectionVersion).toBe(4);
    expect(match.selectedCount).toBe(1);
  });

  it("is 0 before the squad's first change", async () => {
    install([fixture(HIGH, "HKFC B", [])]);
    const { match } = await getPlayersForMatch(ENV, HIGH, "home");
    expect(match.selectionVersion).toBe(0);
  });
});

describe("Supabase: apply_squad_changes", () => {
  const env = {
    DATA_BACKEND: "supabase",
    DATA_SUPABASE_URL: "https://proj.supabase.co",
    DATA_SUPABASE_SECRET_KEY: "sb_secret_test",
  } as Env;

  function postgrest(response: unknown) {
    const calls: { url: URL; body: any }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
      calls.push({ url: new URL(input), body: init.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(response), { status: 200 });
    }));
    return calls;
  }

  it("is one rpc with the change, the version, the actor and the source", async () => {
    const calls = postgrest({ status: "ok", version: 2, otherVersion: null, added: ["recA"], removed: [], selected: ["recA"] });

    const r = await supabaseMatches(env).applySelectionChanges("recM1", {
      side: "away", add: ["recA"], remove: ["recB"], version: 1, actorId: "recCoach", source: "coach",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe("/rest/v1/rpc/apply_squad_changes");
    expect(calls[0].body).toEqual({
      p_match: "recM1", p_side: "away", p_add: ["recA"], p_remove: ["recB"], p_version: 1, p_actor: "recCoach", p_source: "coach",
    });
    expect(r).toEqual({ status: "ok", version: 2, otherVersion: null, added: ["recA"], removed: [], selected: ["recA"] });
  });

  it("sends a release with no version and no actor as nulls", async () => {
    const calls = postgrest({ status: "unchanged", version: 4, selected: [] });

    await supabaseMatches(env).applySelectionChanges("recM1", { side: "home", add: [], remove: ["recB"], version: null, source: "release" });

    expect(calls[0].body).toMatchObject({ p_version: null, p_actor: null, p_source: "release" });
  });

  it("reads each side's version off api_matches", () => {
    const row = { id: "recM1", selected_players_home: [], selected_players_away: [], selection_version_home: 3, selection_version_away: 1 } as unknown as MatchRow;
    expect(toMatch(row)).toMatchObject({ selectionVersionHome: 3, selectionVersionAway: 1 });
  });
});
