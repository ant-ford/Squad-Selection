import { describe, it, expect, vi, beforeEach } from "vitest";

// Unit tests proving Section Captains (Teams."Section Captain" field) get the
// same coach-level profile as coaches - the frontend gates (CoachLayout,
// AppHeader, calendar team operations) read isCoach / coachTeams.

const mocks = vi.hoisted(() => ({
  getPlayerByEmail: vi.fn(),
  getReferenceData: vi.fn(),
  getExceptionsForSeasons: vi.fn(),
  getTeamCoachLinks: vi.fn(),
}));

vi.mock("../worker/src/reference", () => ({
  getPlayerByEmail: mocks.getPlayerByEmail,
  getReferenceData: mocks.getReferenceData,
  getExceptionsForSeasons: mocks.getExceptionsForSeasons,
  getTeamCoachLinks: mocks.getTeamCoachLinks,
}));

import { getMyProfile } from "../worker/src/profile";
import { getMyFixtures } from "../worker/src/fixtures";
import { invalidateAll } from "../src/lib/cache";

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

beforeEach(() => {
  invalidateAll();
  vi.clearAllMocks();
  mocks.getPlayerByEmail.mockResolvedValue(captain);
  mocks.getReferenceData.mockResolvedValue(ref);
  mocks.getExceptionsForSeasons.mockResolvedValue([]);
  mocks.getTeamCoachLinks.mockResolvedValue({
    coachIds: [],
    sectionCaptainIds: ["recCap"],
    cached: false,
  });
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
    const profile = await getMyProfile(ENV, "ada@hkfc.com");
    expect(profile.isCoach).toBe(true);
    expect(profile.isSectionCaptain).toBe(true);
    expect(profile.coachTeams.map((t) => t.teamName)).toContain("HKFC A");
  });

  it("getMyFixtures reports the captain as a coach", async () => {
    const data = await getMyFixtures(ENV, "ada@hkfc.com");
    expect(data.isCoach).toBe(true);
    expect(data.coachTeams).toContain("HKFC A");
  });
});
