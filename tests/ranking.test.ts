import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Ranking engine (worker/src/ranking.ts), on the Supabase path.
//
// Regression coverage for the activatePlayer rank-hole bug: an Applicant
// already present in fetchActiveRanking's pool (with their own
// Section Rank) must keep that rank on activation instead of being appended
// past the end of the list.
//
// The real Supabase repositories run against fakePostgrest (see
// tests/helpers/rankingDb.ts), so a rank write is the update_people_ranks
// call it is in production: one transaction for the whole batch.
// ---------------------------------------------------------------------------

import { activatePlayer, deactivatePlayer, reorderRanking, setAbilityGroupConfig } from "../worker/src/ranking";
import { invalidateAll } from "../worker/src/cache";
import { coachesPlayer, type AuthorizedUser } from "../worker/src/auth";
import type { Player } from "../shared/schema/domainTypes";
import type { Env } from "../worker/src/env";
import { SUPABASE_TEST_ENV } from "./helpers/postgrest";
import { recId, signedIn } from "./helpers/factories";
import { personRow, rankingDb, type PersonRow, type RankingDb } from "./helpers/rankingDb";

const ENV = { ...SUPABASE_TEST_ENV } as unknown as Env;

const A1 = recId("A1");
const A2 = recId("A2");
const A3 = recId("A3");
const APP = recId("App");
const NEW_PLAYER = recId("NewPlayer");

let db: RankingDb;

/** Seeds People (api_players/people) and nothing else. */
function seed(...people: PersonRow[]) {
  db.people.push(...people);
}

beforeEach(() => {
  invalidateAll();
  db = rankingDb();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("activatePlayer", () => {
  it("activating an in-list Applicant keeps their existing rank and leaves the list contiguous", async () => {
    // Ranks 1..3 are Active; rank 4 is an Applicant already holding a slot
    // in the same numbering sequence (listRankingPool pulls in non-rejected
    // Applicants alongside Active players).
    seed(
      personRow("A1", { active: true, section_rank: 1 }),
      personRow("A2", { active: true, section_rank: 2 }),
      personRow("A3", { active: true, section_rank: 3 }),
      personRow("App", { active: false, status: "Applicant", section_rank: 4 }),
    );

    await activatePlayer(ENV, APP, "coach@hkfc.com");

    const ranks = db.people
      .map((p) => ({ id: p.id, active: p.active, rank: p.section_rank as number }))
      .sort((a, b) => a.rank - b.rank);
    expect(ranks).toEqual([
      { id: A1, active: true, rank: 1 },
      { id: A2, active: true, rank: 2 },
      { id: A3, active: true, rank: 3 },
      { id: APP, active: true, rank: 4 },
    ]);
    // No hole, no duplicate, no out-of-range value.
    const allRanks = ranks.map((r) => r.rank);
    expect(allRanks).toEqual([1, 2, 3, 4]);
    // Already contiguous: the safety-net renumbering sends no rank change
    // (update_people_ranks carries only the Playing Ability refresh).
    const rankWrites = db.pg.rpcCalls("update_people_ranks").flatMap((c) => c.p).filter((w: object) => "sectionRank" in w);
    expect(rankWrites).toEqual([]);
    // The activation itself is audited, keeping the rank they already had.
    expect(db.pg.rpcCalls("insert_ranking_events")[0].p).toEqual([
      expect.objectContaining({ playerId: APP, kind: "activate", oldRank: 4, newRank: 4 }),
    ]);
  });

  it("appends a genuinely new player (no existing rank) at the end", async () => {
    seed(
      personRow("A1", { active: true, section_rank: 1 }),
      personRow("A2", { active: true, section_rank: 2 }),
      personRow("NewPlayer", { active: false, status: null, applicant_stage: null, section_rank: null }),
    );

    await activatePlayer(ENV, NEW_PLAYER, "coach@hkfc.com");

    const newPlayer = db.people.find((p) => p.id === NEW_PLAYER)!;
    expect(newPlayer.active).toBe(true);
    expect(newPlayer.section_rank).toBe(3);
  });
});

function sectionCaptain(): AuthorizedUser {
  return signedIn({ email: "captain@hkfc.com", personId: recId("Captain"), role: "coach", coachTeams: [], isSectionCaptain: true, officerRoles: [] });
}

function ranksOf(): { id: string; rank: number }[] {
  return db.people
    .filter((p) => p.active === true)
    .map((p) => ({ id: p.id, rank: p.section_rank as number }))
    .sort((a, b) => a.rank - b.rank);
}

describe("reorderRanking", () => {
  beforeEach(() => {
    seed(
      personRow("A1", { active: true, section_rank: 1 }),
      personRow("A2", { active: true, section_rank: 2 }),
      personRow("A3", { active: true, section_rank: 3 }),
    );
  });

  it("keeps ranks contiguous after a reorder", async () => {
    await reorderRanking(ENV, [A3, A1, A2], "coach@hkfc.com");
    expect(ranksOf()).toEqual([
      { id: A3, rank: 1 },
      { id: A1, rank: 2 },
      { id: A2, rank: 3 },
    ]);
    // Every changed rank went in ONE update_people_ranks call (one transaction).
    const [first] = db.pg.rpcCalls("update_people_ranks");
    expect(first.p).toEqual([
      { id: A3, sectionRank: 1, rankUpdatedAt: expect.any(String) },
      { id: A1, sectionRank: 2, rankUpdatedAt: expect.any(String) },
      { id: A2, sectionRank: 3, rankUpdatedAt: expect.any(String) },
    ]);
  });

  it("answers with each player's Selected Team, as the ranking read does", async () => {
    Object.assign(db.people[1], { registered_team: "HKFC C", selected_team_eos: "HKFC B" });
    Object.assign(db.people[2], { registered_team: "HKFC A" });
    const list = await reorderRanking(ENV, [A3, A1, A2], "coach@hkfc.com");
    const teamOf = (id: string) => list.players.find((p) => p.id === id)?.registeredTeam;
    expect(teamOf(A2)).toBe("HKFC B");
    expect(teamOf(A3)).toBe("HKFC A");
  });

  it("rejects a stale playerIds list (wrong count) with 409", async () => {
    await expect(
      reorderRanking(ENV, [A1, A2], "coach@hkfc.com"),
    ).rejects.toMatchObject({ status: 409 });
    // Nothing was written - the stale request never reaches the batch update.
    expect(ranksOf()).toEqual([
      { id: A1, rank: 1 },
      { id: A2, rank: 2 },
      { id: A3, rank: 3 },
    ]);
    expect(db.pg.rpcCalls("update_people_ranks")).toEqual([]);
  });

  // Coaches act only on their own teams (owner decision, 7 Oct 2026). The
  // ranking stays one section-wide list: a coach moves their own players,
  // and the others may shift but keep their order among themselves.
  describe("a coach of one team", () => {
    const coachOfA = signedIn({ email: "coach@hkfc.com", personId: recId("CoachA"), role: "coach", coachTeams: ["HKFC A"], isSectionCaptain: false, officerRoles: [] });
    const mayMove = (p: Player) => coachesPlayer(coachOfA, p);

    beforeEach(() => {
      Object.assign(db.people[0], { registered_team: "HKFC B" });
      Object.assign(db.people[1], { registered_team: "HKFC B" });
      Object.assign(db.people[2], { registered_team: "HKFC A" });
    });

    it("moves their own player past others, who shift but keep their order", async () => {
      await reorderRanking(ENV, [A3, A1, A2], "coach@hkfc.com", undefined, mayMove);
      expect(ranksOf().map((r) => r.id)).toEqual([A3, A1, A2]);
    });

    it("may not reorder another team's players: 403 NOT_YOUR_TEAM, nothing written", async () => {
      await expect(reorderRanking(ENV, [A2, A1, A3], "coach@hkfc.com", undefined, mayMove)).rejects.toMatchObject({
        status: 403,
        code: "NOT_YOUR_TEAM",
      });
      expect(ranksOf().map((r) => r.id)).toEqual([A1, A2, A3]);
      expect(db.pg.rpcCalls("update_people_ranks")).toEqual([]);
    });

    it("counts the team the app shows the player in, as well as the registered one", async () => {
      Object.assign(db.people[1], { selected_team_eos: "HKFC A" });
      await reorderRanking(ENV, [A2, A1, A3], "coach@hkfc.com", undefined, mayMove);
      expect(ranksOf().map((r) => r.id)).toEqual([A2, A1, A3]);
    });

    it("may move a player who is in no team yet", async () => {
      Object.assign(db.people[0], { registered_team: null });
      await reorderRanking(ENV, [A2, A3, A1], "coach@hkfc.com", undefined, mayMove);
      expect(ranksOf().map((r) => r.id)).toEqual([A2, A3, A1]);
    });
  });
});

describe("deactivatePlayer", () => {
  it("keeps the remaining ranks contiguous 1..N after removing a middle player", async () => {
    seed(
      personRow("A1", { active: true, section_rank: 1 }),
      personRow("A2", { active: true, section_rank: 2 }),
      personRow("A3", { active: true, section_rank: 3 }),
    );

    await deactivatePlayer(ENV, A2, "coach@hkfc.com");

    const a2 = db.people.find((p) => p.id === A2)!;
    expect(a2.active).toBe(false);
    expect(a2.section_rank).toBeNull();
    expect(ranksOf()).toEqual([
      { id: A1, rank: 1 },
      { id: A3, rank: 2 },
    ]);
    // The players below moved up in one update_people_ranks call.
    expect(db.pg.rpcCalls("update_people_ranks")[0].p).toEqual([
      { id: A3, sectionRank: 2, rankUpdatedAt: expect.any(String) },
    ]);
  });
});

describe("setAbilityGroupConfig", () => {
  it("rejects a total capacity greater than the active player count", async () => {
    seed(
      personRow("A1", { active: true, section_rank: 1 }),
      personRow("A2", { active: true, section_rank: 2 }),
    );
    const config = { A: 1, B: 1, C: 1, D: 0, E: 0, F: 0, G: 0 }; // totals 3, only 2 active

    await expect(
      setAbilityGroupConfig(ENV, config, sectionCaptain()),
    ).rejects.toMatchObject({ status: 400 });
    // Rejected before any config write.
    expect(db.abilityGroups).toEqual([]);
    expect(db.pg.writes("ability_group_config")).toEqual([]);
  });

  it("rejects a non-Section-Captain caller", async () => {
    const notCaptain: AuthorizedUser = signedIn({ email: "coach@hkfc.com", personId: recId("Coach"), role: "coach", coachTeams: ["A"], isSectionCaptain: false, officerRoles: [] });
    await expect(
      setAbilityGroupConfig(ENV, { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 }, notCaptain),
    ).rejects.toMatchObject({ status: 403 });
  });
});
