import { describe, it, expect, vi, beforeEach } from "vitest";

// My profile reads the Active teams and nothing else: the person, their
// captaincies and the officer screens came with sign-in (auth_context).

const mocks = vi.hoisted(() => ({
  getActiveTeams: vi.fn(),
}));

vi.mock("../worker/src/reference", () => ({
  getActiveTeams: mocks.getActiveTeams,
  UNRANKED_TEAM_RANK: 999,
}));

import { getMyProfile } from "../worker/src/profile";
import { signedIn } from "./helpers/factories";

const ENV = {} as any;

const player = signedIn({
  email: "ada@hkfc.com",
  personId: "recAda",
  personUuid: "uuid-ada",
  person: { id: "recAda", uuid: "uuid-ada", preferredName: "Ada", status: "Member", playerCoach: ["Player"] },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getActiveTeams.mockResolvedValue([]);
});

describe("my profile's reads", () => {
  it("reads only the teams; the person came with sign-in", async () => {
    mocks.getActiveTeams.mockResolvedValue([
      { id: "t2", teamName: "HKFC D", teamRank: 4, targetSquadSize: 0 },
      { id: "t1", teamName: "HKFC C", teamRank: 3, targetSquadSize: 18 },
    ]);
    const p = await getMyProfile(ENV, { ...player, role: "coach", coachTeams: ["HKFC C", "HKFC D"] });
    expect(mocks.getActiveTeams).toHaveBeenCalledTimes(1);
    expect(p.preferredName).toBe("Ada");
    expect(p.roles).toEqual(["Player"]);
    expect(p.inviteLink).toContain("ref=recAda");
    expect(p.coachTeams).toEqual([
      { id: "t1", teamName: "HKFC C", teamRank: 3, targetSquadSize: 18 },
      { id: "t2", teamName: "HKFC D", teamRank: 4, targetSquadSize: 16 },
    ]);
  });

  it("takes captaincies and the officer screens from sign-in", async () => {
    const p = await getMyProfile(ENV, {
      ...player,
      role: "coach",
      coachTeams: ["HKFC C"],
      captainTeams: ["HKFC C"],
      offices: [{ role: "social_secretary", office: null, designation: "" }],
      umpire: true,
    });
    expect(p.captainTeams).toEqual(["HKFC C"]);
    expect(p.volunteers).toBe(true);
    expect(p.events).toBe(true);
    expect(p.umpiring).toBe("umpire");
  });

  it("shows a plain player none of the officer screens", async () => {
    const p = await getMyProfile(ENV, player);
    expect(p).toMatchObject({ volunteers: false, events: false, umpiring: null, system: false, captainTeams: [] });
  });

  it("offers System to the Section Captains and the owner, not to other officers", async () => {
    const officer = (office: "sectionCaptain" | "hockeyConvenor") => ({ ...player, officerRoles: [{ office, designation: "" }] });
    expect((await getMyProfile(ENV, officer("sectionCaptain"))).system).toBe(true);
    expect((await getMyProfile(ENV, officer("hockeyConvenor"))).system).toBe(false);
    expect((await getMyProfile({ SYSTEM_OWNER_IDS: "recAda" } as any, player)).system).toBe(true);
  });
});
