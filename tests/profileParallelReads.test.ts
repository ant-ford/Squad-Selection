import { describe, it, expect, vi, beforeEach } from "vitest";

// The profile's volunteers, events and umpiring answers are separate reads.
// They are asked together, so one slow answer doesn't hold up the others.

const mocks = vi.hoisted(() => ({
  getPlayerByEmail: vi.fn(),
  getReferenceData: vi.fn(),
  canSeeVolunteers: vi.fn(),
  canManageEvents: vi.fn(),
  umpiringAccess: vi.fn(),
}));

vi.mock("../worker/src/reference", () => ({
  getPlayerByEmail: mocks.getPlayerByEmail,
  getReferenceData: mocks.getReferenceData,
  UNRANKED_TEAM_RANK: 999,
}));
vi.mock("../worker/src/volunteerAccess", () => ({ canSeeVolunteers: mocks.canSeeVolunteers }));
vi.mock("../worker/src/eventAccess", () => ({ canManageEvents: mocks.canManageEvents }));
vi.mock("../worker/src/umpiring", () => ({ umpiringAccess: mocks.umpiringAccess }));

import { getMyProfile } from "../worker/src/profile";
import type { AuthorizedUser } from "../worker/src/auth";

const ENV = { DATA_BACKEND: "supabase" } as any;

const player: AuthorizedUser = {
  email: "ada@hkfc.com",
  personId: "recAda",
  role: "player",
  coachTeams: [],
  isSectionCaptain: false,
  officerRoles: [],
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPlayerByEmail.mockResolvedValue({ id: "recAda", preferredName: "Ada", status: "Member" });
  mocks.getReferenceData.mockResolvedValue({ teams: [], players: [], teamRankMap: {}, teamNames: [] });
});

describe("my profile's access reads", () => {
  it("asks all three before any has answered", async () => {
    const volunteers = deferred<boolean>();
    const events = deferred<boolean>();
    const umpiring = deferred<"umpire" | null>();
    mocks.canSeeVolunteers.mockReturnValue(volunteers.promise);
    mocks.canManageEvents.mockReturnValue(events.promise);
    mocks.umpiringAccess.mockReturnValue(umpiring.promise);

    const profile = getMyProfile(ENV, player);
    await flush();
    expect(mocks.canSeeVolunteers).toHaveBeenCalledTimes(1);
    expect(mocks.canManageEvents).toHaveBeenCalledTimes(1);
    expect(mocks.umpiringAccess).toHaveBeenCalledTimes(1);

    umpiring.resolve("umpire");
    events.resolve(false);
    volunteers.resolve(true);
    const p = await profile;
    expect(p.volunteers).toBe(true);
    expect(p.events).toBe(false);
    expect(p.umpiring).toBe("umpire");
  });

  it("still fails the profile when the volunteers read fails", async () => {
    mocks.canSeeVolunteers.mockRejectedValue(new Error("offices unreadable"));
    mocks.canManageEvents.mockResolvedValue(false);
    mocks.umpiringAccess.mockResolvedValue(null);
    await expect(getMyProfile(ENV, player)).rejects.toThrow("offices unreadable");
  });
});
