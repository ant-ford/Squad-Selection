import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Ranking engine (worker/src/ranking.ts)
//
// Regression coverage for the activatePlayer rank-hole bug: an Applicant
// already present in fetchActiveRankingFromAirtable's pool (with their own
// Section Rank) must keep that rank on activation instead of being appended
// past the end of the list.
// ---------------------------------------------------------------------------

import { activatePlayer, deactivatePlayer, reorderRanking, setAbilityGroupConfig } from "../worker/src/ranking";
import { invalidateAll } from "../worker/src/cache";
import type { AuthorizedUser } from "../worker/src/auth";

const ENV = {
  AIRTABLE_TOKEN: "***",
  AIRTABLE_BASE_ID: "test-base",
  CALENDAR_SECRET: "***",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

function person(id: string, fields: Record<string, unknown>) {
  return { id, fields: { "Preferred Name": id, Email: `${id}@hkfc.com`, "Applicant Stage": "", Status: "", ...fields } };
}

let state: { people: any[]; rankingEvents: any[]; abilityConfig: any[] };
let nextId: number;

function installFakeAirtable() {
  const fetchMock = vi.fn((url: any, init?: any) => {
    const u = String(url);
    if (!u.includes("api.airtable.com")) return Promise.resolve(new Response("{}", { status: 404 }));
    const table = decodeURIComponent((u.match(/\/v0\/[^/]+\/([^/?]+)/) ?? [])[1] ?? "");
    const method = init?.method ?? "GET";
    const store = (): any[] =>
      table === "People" ? state.people
      : table === "Ranking Events" ? state.rankingEvents
      : table === "Ability Group Configuration" ? state.abilityConfig
      : [];

    if (method === "PATCH") {
      const byId = u.match(/\/rec[A-Za-z0-9]+$/);
      if (byId) {
        const id = byId[0].slice(1);
        const body = JSON.parse(init.body);
        const target = store().find((r) => r.id === id);
        if (target) target.fields = { ...target.fields, ...body.fields };
        return Promise.resolve(new Response(JSON.stringify(target ?? {}), { status: 200 }));
      }
      // Batch PATCH: table-level URL, body.records = [{id, fields}, ...]
      const body = JSON.parse(init.body);
      const updated = (body.records ?? []).map((r: any) => {
        const target = store().find((x) => x.id === r.id);
        if (target) target.fields = { ...target.fields, ...r.fields };
        return target ?? { id: r.id, fields: r.fields };
      });
      return Promise.resolve(new Response(JSON.stringify({ records: updated }), { status: 200 }));
    }
    if (method === "POST") {
      const body = JSON.parse(init.body);
      const created = (body.records ?? []).map((r: any) => ({ id: `recNew${nextId++}`, fields: r.fields }));
      store().push(...created);
      return Promise.resolve(new Response(JSON.stringify({ records: created }), { status: 200 }));
    }

    const byId = u.match(/\/rec[A-Za-z0-9]+$/);
    if (byId) {
      const found = store().find((r) => r.id === byId[0].slice(1));
      return Promise.resolve(new Response(JSON.stringify(found ?? {}), { status: found ? 200 : 404 }));
    }
    // fetchActiveRankingFromAirtable's formula, honoured here so
    // activePlayers.length matches what the real filter would return:
    // AND({Applicant Stage}!="Rejected", {Status}!="Resigned", OR({Active}=TRUE(), {Status}="Applicant"))
    const records =
      table === "People"
        ? store().filter(
            (r) =>
              r.fields["Applicant Stage"] !== "Rejected" &&
              r.fields["Status"] !== "Resigned" &&
              (r.fields["Active"] === true || r.fields["Status"] === "Applicant"),
          )
        : store();
    return Promise.resolve(new Response(JSON.stringify({ records }), { status: 200 }));
  }) as any;
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  invalidateAll();
  nextId = 1;
  state = { people: [], rankingEvents: [], abilityConfig: [] };
  installFakeAirtable();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("activatePlayer", () => {
  it("activating an in-list Applicant keeps their existing rank and leaves the list contiguous", async () => {
    // Ranks 1..3 are Active; rank 4 is an Applicant already holding a slot
    // in the same numbering sequence (fetchActiveRankingFromAirtable pulls
    // in non-rejected Applicants alongside Active players).
    state.people = [
      person("recA1", { Active: true, "Section Rank": 1 }),
      person("recA2", { Active: true, "Section Rank": 2 }),
      person("recA3", { Active: true, "Section Rank": 3 }),
      person("recApp", { Active: false, Status: "Applicant", "Section Rank": 4 }),
    ];

    await activatePlayer(ENV, "recApp", "coach@hkfc.com");

    const ranks = state.people
      .map((p) => ({ id: p.id, active: p.fields.Active, rank: p.fields["Section Rank"] }))
      .sort((a, b) => a.rank - b.rank);
    expect(ranks).toEqual([
      { id: "recA1", active: true, rank: 1 },
      { id: "recA2", active: true, rank: 2 },
      { id: "recA3", active: true, rank: 3 },
      { id: "recApp", active: true, rank: 4 },
    ]);
    // No hole, no duplicate, no out-of-range value.
    const allRanks = ranks.map((r) => r.rank);
    expect(allRanks).toEqual([1, 2, 3, 4]);
  });

  it("appends a genuinely new player (no existing rank) at the end", async () => {
    state.people = [
      person("recA1", { Active: true, "Section Rank": 1 }),
      person("recA2", { Active: true, "Section Rank": 2 }),
      person("recNewPlayer", { Active: false, Status: "", "Applicant Stage": "", "Section Rank": null }),
    ];

    await activatePlayer(ENV, "recNewPlayer", "coach@hkfc.com");

    const newPlayer = state.people.find((p) => p.id === "recNewPlayer")!;
    expect(newPlayer.fields.Active).toBe(true);
    expect(newPlayer.fields["Section Rank"]).toBe(3);
  });
});

function sectionCaptain(): AuthorizedUser {
  return { email: "captain@hkfc.com", personId: "recCaptain", role: "coach", coachTeams: [], isSectionCaptain: true };
}

function ranksOf(): { id: string; rank: number }[] {
  return state.people
    .filter((p) => p.fields.Active === true)
    .map((p) => ({ id: p.id, rank: p.fields["Section Rank"] }))
    .sort((a, b) => a.rank - b.rank);
}

describe("reorderRanking", () => {
  beforeEach(() => {
    state.people = [
      person("recA1", { Active: true, "Section Rank": 1 }),
      person("recA2", { Active: true, "Section Rank": 2 }),
      person("recA3", { Active: true, "Section Rank": 3 }),
    ];
  });

  it("keeps ranks contiguous after a reorder", async () => {
    await reorderRanking(ENV, ["recA3", "recA1", "recA2"], "coach@hkfc.com");
    expect(ranksOf()).toEqual([
      { id: "recA3", rank: 1 },
      { id: "recA1", rank: 2 },
      { id: "recA2", rank: 3 },
    ]);
  });

  it("rejects a stale playerIds list (wrong count) with 409", async () => {
    await expect(
      reorderRanking(ENV, ["recA1", "recA2"], "coach@hkfc.com"),
    ).rejects.toMatchObject({ status: 409 });
    // Nothing was written - the stale request never reaches the batch update.
    expect(ranksOf()).toEqual([
      { id: "recA1", rank: 1 },
      { id: "recA2", rank: 2 },
      { id: "recA3", rank: 3 },
    ]);
  });
});

describe("deactivatePlayer", () => {
  it("keeps the remaining ranks contiguous 1..N after removing a middle player", async () => {
    state.people = [
      person("recA1", { Active: true, "Section Rank": 1 }),
      person("recA2", { Active: true, "Section Rank": 2 }),
      person("recA3", { Active: true, "Section Rank": 3 }),
    ];

    await deactivatePlayer(ENV, "recA2", "coach@hkfc.com");

    const recA2 = state.people.find((p) => p.id === "recA2")!;
    expect(recA2.fields.Active).toBe(false);
    expect(recA2.fields["Section Rank"]).toBeNull();
    expect(ranksOf()).toEqual([
      { id: "recA1", rank: 1 },
      { id: "recA3", rank: 2 },
    ]);
  });
});

describe("setAbilityGroupConfig", () => {
  it("rejects a total capacity greater than the active player count", async () => {
    state.people = [
      person("recA1", { Active: true, "Section Rank": 1 }),
      person("recA2", { Active: true, "Section Rank": 2 }),
    ];
    const config = { A: 1, B: 1, C: 1, D: 0, E: 0, F: 0, G: 0 }; // totals 3, only 2 active

    await expect(
      setAbilityGroupConfig(ENV, config, sectionCaptain()),
    ).rejects.toMatchObject({ status: 400 });
    // Rejected before any config write.
    expect(state.abilityConfig).toEqual([]);
  });

  it("rejects a non-Section-Captain caller", async () => {
    const notCaptain: AuthorizedUser = { email: "coach@hkfc.com", personId: "recCoach", role: "coach", coachTeams: ["A"], isSectionCaptain: false };
    await expect(
      setAbilityGroupConfig(ENV, { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 }, notCaptain),
    ).rejects.toMatchObject({ status: 403 });
  });
});
