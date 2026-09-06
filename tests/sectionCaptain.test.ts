import { describe, it, expect, vi, beforeEach } from "vitest";

// Section Captains share coach access (Teams."Section Captain" field). That
// determination is made exactly once, in worker/src/auth.ts's
// requireAuthorizedUser (see tests/authorization.test.ts for coverage of the
// derivation itself: isSectionCaptain -> coachTeams = every team name).
// These tests prove getMyProfile / getMyFixtures surface what the
// AuthorizedUser says, rather than re-deriving it from Teams links.

const mocks = vi.hoisted(() => ({
  getPlayerByEmail: vi.fn(),
  getReferenceData: vi.fn(),
  getExceptionsForSeasons: vi.fn(),
}));

vi.mock("../worker/src/reference", () => ({
  getPlayerByEmail: mocks.getPlayerByEmail,
  getReferenceData: mocks.getReferenceData,
  getExceptionsForSeasons: mocks.getExceptionsForSeasons,
}));

import { getMyProfile } from "../worker/src/profile";
import { getMyFixtures } from "../worker/src/fixtures";
import { invalidateAll } from "../worker/src/cache";
import type { AuthorizedUser } from "../worker/src/auth";

const ENV = { AIRTABLE_TOKEN: "***", AIRTABLE_BASE_ID: "test-base" } as any;

const captain = {
  id: "recCap",
  preferredName: "Ada",
  givenNames: "Ada",
  email: "ada@hkfc.com",
  active: true,
  registeredTeam: "HKFC B",
  playingPosition: "Forward",
  shirtNoValue: "9",
  playerCoach: [],
};

const teams = [
  {
    id: "recT1", teamName: "HKFC A", coach: ["recOther"], teamCaptain: [],
    sectionCaptain: ["recCap"], teamRank: 1, targetSquadSize: 16,
  },
  {
    id: "recT2", teamName: "HKFC B", coach: [], teamCaptain: [],
    sectionCaptain: [], teamRank: 2, targetSquadSize: 16,
  },
];

const ref = {
  teams,
  players: [
    captain,
    { id: "recOther", preferredName: "Other", givenNames: "Other", email: "o@hkfc.com" },
  ],
  teamRankMap: { "HKFC A": 1, "HKFC B": 2 },
};

// The AuthorizedUser auth.ts would produce for Ada: Section Captain, so
// coachTeams is every team name (see B7 - the single source of coach truth).
const captainAuthUser: AuthorizedUser = {
  email: "ada@hkfc.com",
  personId: "recCap",
  role: "coach",
  coachTeams: ["HKFC A", "HKFC B"],
  isSectionCaptain: true,
};

beforeEach(() => {
  invalidateAll();
  vi.clearAllMocks();
  mocks.getPlayerByEmail.mockResolvedValue(captain);
  mocks.getReferenceData.mockResolvedValue(ref);
  mocks.getExceptionsForSeasons.mockResolvedValue([]);
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ records: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ),
  );
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
