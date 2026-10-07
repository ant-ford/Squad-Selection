import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Section Captains share coach access (Teams."Section Captain" field). That
// determination is made exactly once, in worker/src/auth.ts's
// requireAuthorizedUser (see tests/authorization.test.ts for coverage of the
// derivation itself: isSectionCaptain -> coachTeams = every team name).
// These tests prove getMyProfile / getMyFixtures surface what the
// AuthorizedUser says, rather than re-deriving it from Teams links.
//
// Runs on the Supabase path: the player and teams come from the in-memory
// repositories, so the Teams links really are there to be (wrongly) re-read:
// Ada is Section Captain of HKFC A only, yet must coach both teams.

import { getMyProfile } from "../worker/src/profile";
import { getMyFixtures } from "../worker/src/fixtures";
import { invalidateAll } from "../worker/src/cache";
import type { AuthorizedUser } from "../worker/src/auth";
import type { Env } from "../worker/src/env";
import { useFakeRepos } from "./helpers/fakeRepos";
import { fakePostgrest, SUPABASE_TEST_ENV } from "./helpers/postgrest";
import { person, recId, team, signedIn } from "./helpers/factories";

const ENV = { ...SUPABASE_TEST_ENV } as unknown as Env;

const CAP = recId("Cap");
const OTHER = recId("Other");

useFakeRepos(() => ({
  people: [
    person({
      id: CAP,
      preferredName: "Ada",
      givenNames: "Ada",
      email: "ada@hkfc.com",
      active: true,
      registeredTeam: "HKFC B",
      playingPosition: "Forward",
      shirtNoValue: "9",
      playerCoach: [],
    }),
    person({ id: OTHER, preferredName: "Other", givenNames: "Other", email: "o@hkfc.com", active: true }),
  ],
  teams: [
    team({ teamName: "HKFC A", coach: [OTHER], teamCaptain: [], sectionCaptain: [CAP], teamRank: 1, targetSquadSize: 16 }),
    team({ teamName: "HKFC B", coach: [], teamCaptain: [], sectionCaptain: [], teamRank: 2, targetSquadSize: 16 }),
  ],
}));

// The AuthorizedUser auth.ts would produce for Ada: Section Captain, so
// coachTeams is every team name (see B7 - the single source of coach truth).
const captainAuthUser: AuthorizedUser = signedIn({
  email: "ada@hkfc.com",
  personId: CAP,
  role: "coach",
  coachTeams: ["HKFC A", "HKFC B"],
  isSectionCaptain: true,
  officerRoles: [],
});

beforeEach(() => {
  invalidateAll();
  // Both screens also ask Supabase directly whether Ada keeps volunteers,
  // events or umpiring duties. Nothing seeded: none of them.
  fakePostgrest({
    tables: { api_offices: [], people: [], offices: [], team_people: [], matches: [], umpire_assignments: [] },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Section Captains share coach access", () => {
  it("getMyProfile reports the captain as a coach with their teams in coachTeams", async () => {
    const profile = await getMyProfile(ENV, captainAuthUser);
    expect(profile.isCoach).toBe(true);
    expect(profile.isSectionCaptain).toBe(true);
    expect(profile.coachTeams.map((t) => t.teamName)).toContain("HKFC A");
    expect(profile.coachTeams.map((t) => t.teamName)).toContain("HKFC B");
  });

  it("getMyFixtures reports the captain as a coach", async () => {
    const data = await getMyFixtures(ENV, captainAuthUser);
    expect(data.isCoach).toBe(true);
    expect(data.coachTeams).toContain("HKFC A");
  });
});
