import { describe, it, expect, vi, beforeEach } from "vitest";

// My profile reads the person and the Active teams, together. Everything
// else (captaincies, the officer screens) came with sign-in (auth_context).

const mocks = vi.hoisted(() => ({
  getPlayerByEmail: vi.fn(),
  getActiveTeams: vi.fn(),
}));

vi.mock("../worker/src/reference", () => ({
  getPlayerByEmail: mocks.getPlayerByEmail,
  getActiveTeams: mocks.getActiveTeams,
  UNRANKED_TEAM_RANK: 999,
}));

import { getMyProfile } from "../worker/src/profile";
import { signedIn } from "./helpers/factories";

const ENV = {} as any;

const player = signedIn({ email: "ada@hkfc.com", personId: "recAda", personUuid: "uuid-ada" });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPlayerByEmail.mockResolvedValue({ id: "recAda", preferredName: "Ada", status: "Member" });
  mocks.getActiveTeams.mockResolvedValue([]);
});

describe("my profile's reads", () => {
  it("asks for the person and the teams before either has answered", async () => {
    const person = deferred<unknown>();
    const teams = deferred<unknown[]>();
    mocks.getPlayerByEmail.mockReturnValue(person.promise);
    mocks.getActiveTeams.mockReturnValue(teams.promise);

    const profile = getMyProfile(ENV, player);
    await flush();
    expect(mocks.getPlayerByEmail).toHaveBeenCalledTimes(1);
    expect(mocks.getActiveTeams).toHaveBeenCalledTimes(1);

    teams.resolve([{ id: "t1", teamName: "HKFC C", teamRank: 3, targetSquadSize: 16 }]);
    person.resolve({ id: "recAda", preferredName: "Ada", status: "Member" });
    expect((await profile).preferredName).toBe("Ada");
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
    expect(p).toMatchObject({ volunteers: false, events: false, umpiring: null, captainTeams: [] });
  });
});
