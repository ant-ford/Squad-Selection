import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Regression for bug B6: an upstream read failure during the player-portal
// play-up eligibility gate (worker/src/fixtures.ts :: isEligibleFor) used to
// be swallowed and silently treated as "not eligible" - an outage would just
// make play-up opportunities vanish instead of surfacing as an error.
//
// Runs on the Supabase path: the in-memory repositories, with the Match
// Cards read failing as Supabase fails (a SupabaseError).
// ---------------------------------------------------------------------------

import { getMyFixtures } from "../worker/src/fixtures";
import { invalidateAll } from "../worker/src/cache";
import { SupabaseError } from "../worker/src/data/supabase";
import type { AuthorizedUser } from "../worker/src/auth";
import type { Env } from "../worker/src/env";
import { useFakeRepos } from "./helpers/fakeRepos";
import { fakePostgrest, SUPABASE_TEST_ENV } from "./helpers/postgrest";
import { match, person, recId, team, signedIn } from "./helpers/factories";

function authUser(email: string): AuthorizedUser {
  return signedIn({ email, personId: "", role: "player", coachTeams: [], isSectionCaptain: false, officerRoles: [] });
}

const ENV = { ...SUPABASE_TEST_ENV } as unknown as Env;

function futureIso(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

const M1 = recId("M1");

const db = useFakeRepos(() => ({
  // Ranks 2 and 3 - deliberately not rank 1, which the eligibility engine
  // always treats as Premier Division regardless of the Is Premier flag and
  // would trip the (unrelated) Premier-movement block instead of exercising
  // the play-up gate this test targets.
  teams: [
    team({ teamName: "B", teamRank: 2, active: true, targetSquadSize: 14 }),
    team({ teamName: "C", teamRank: 3, active: true, targetSquadSize: 14 }),
  ],
  people: [
    person({ id: recId("P1"), preferredName: "Dave", email: "dave@hkfc.com", active: true, registeredTeam: "C", playingPosition: "Defender", playingAbility: "B" }),
  ],
  // Team B (rank 2, above Dave's team C) has an upcoming fixture: a play-up
  // opportunity candidate that must be run through the eligibility engine.
  matches: [
    match({ id: M1, matchDate: futureIso(3), season: "2026-2027", homeTeam: "B", awayTeam: "Valley A", matchStatus: "Scheduled" }),
  ],
}));

beforeEach(() => {
  invalidateAll();
  // getMyFixtures also asks Supabase directly whether this player keeps
  // volunteers, events or umpiring duties. None of them.
  fakePostgrest({
    tables: { api_offices: [], people: [], offices: [], team_people: [], matches: [], umpire_assignments: [] },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getMyFixtures play-up eligibility gate", () => {
  it("includes the play-up candidate when the data store is healthy", async () => {
    const out = await getMyFixtures(ENV, authUser("dave@hkfc.com"));
    expect(out.playUpOpportunities.some((f: any) => f.id === M1)).toBe(true);
    // The gate reads Match Cards (the play-up history), the read failed below.
    expect(db.callsTo("matchCards", "listForSeason").length).toBeGreaterThan(0);
  });

  it("propagates a read failure during eligibility gating instead of silently dropping the candidate", async () => {
    vi.spyOn(db.repos.matchCards, "listForSeason").mockRejectedValue(new SupabaseError("Supabase GET api_match_cards failed (500): upstream error", 500));
    await expect(getMyFixtures(ENV, authUser("dave@hkfc.com"))).rejects.toBeInstanceOf(SupabaseError);
  });
});
