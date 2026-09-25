import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Airtable access layer so the auth engine is tested in isolation.
const mocks = vi.hoisted(() => ({
  getPlayerByEmail: vi.fn(),
  getTeamCoachLinks: vi.fn(),
  getOfficerLinks: vi.fn(),
}));

vi.mock("../worker/src/reference", () => ({
  getPlayerByEmail: mocks.getPlayerByEmail,
  getTeamCoachLinks: mocks.getTeamCoachLinks,
  getOfficerLinks: mocks.getOfficerLinks,
}));

import { requireAuthorizedUser, requireCoach, requireSection, sectionsFor, normalizeEmail } from "../worker/src/auth";
import { HttpError } from "../worker/src/http";
import { invalidateAll } from "../worker/src/cache";

const ENV = {
  AIRTABLE_TOKEN: "test-token",
  AIRTABLE_BASE_ID: "test-base",
  CALENDAR_SECRET: "test-secret",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "test-anon-key",
} as any;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Relationships across ALL team records. The lookup used by the auth engine
// deliberately ignores the Teams.Active flag, so a coach/section-captain link
// counts even when the team record is inactive.
const teamLinks = {
  // recUnnamedTeamCoach is linked under Teams.Coach but the team record has
  // a blank Team Name, so it contributes no entry to coachTeamNamesByPersonId.
  coachIds: ["recCoach", "recInactiveCoach", "recUnnamedTeamCoach"],
  sectionCaptainIds: ["recSectionCaptain"],
  coachTeamNamesByPersonId: {
    recCoach: ["Men's 1s"],
    recInactiveCoach: ["Men's 2s"],
  },
  allTeamNames: ["Men's 1s", "Men's 2s", "Men's 3s"],
};

// Active officer rows only - getOfficerLinks drops Retired ones before this.
const officerLinks = {
  rolesByPersonId: {
    recOfficer: [{ office: "membershipOfficer", designation: "Men's Membership Officer" }],
    recChair: [{ office: "sectionChair", designation: "Chairman" }],
    recCoach: [{ office: "sectionChair", designation: "Men's Captain" }],
    recCaptainRow: [{ office: "sectionCaptain", designation: "Men's Vice Captain" }],
  },
};

const people = {
  activePlayer: { id: "recP1", email: "player@hkfc.com", active: true, playerCoach: [] },
  inactivePlayer: { id: "recP2", email: "inactive@hkfc.com", active: false, playerCoach: [] },
  activeCoach: { id: "recCoach", email: "coach@hkfc.com", active: true, playerCoach: [] },
  inactiveCoach: { id: "recInactiveCoach", email: "inactive-coach@hkfc.com", active: false, playerCoach: [] },
  sectionCaptain: { id: "recSectionCaptain", email: "captain@hkfc.com", active: false, playerCoach: [] },
  unnamedTeamCoach: { id: "recUnnamedTeamCoach", email: "unnamed-team-coach@hkfc.com", active: false, playerCoach: [] },
  // Player/Coach alone is no longer a coach-access fallback: no Teams.Coach
  // or Teams.Section Captain link, but the multi-select still says "Coach".
  playerCoachFlagOnly: { id: "recFallback", email: "fallback@hkfc.com", active: false, playerCoach: ["Player/Coach"] },
  // Officers who do not play: Active is false on their People record.
  membershipOfficer: { id: "recOfficer", email: "officer@personal.com", active: false, playerCoach: [] },
  chairman: { id: "recChair", email: "chair@personal.com", active: false, playerCoach: [] },
  // A row in the Section Captains TABLE, not a Teams.Section Captain link.
  sectionCaptainRow: { id: "recCaptainRow", email: "vice@personal.com", active: false, playerCoach: [] },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function supabaseReturns(email: string) {
  vi.mocked(fetch).mockResolvedValue(
    new Response(JSON.stringify({ email }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

// A fresh Response per call: the worker reads the body to log the failure,
// and a single shared instance can only be read once.
function supabaseRejects() {
  vi.mocked(fetch).mockImplementation(async () => new Response("Unauthorized", { status: 401 }));
}

function authedRequest(token = "valid.jwt.token"): Request {
  return new Request("https://hkfc-api.test/api/my-profile", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

function expectError(promise: Promise<unknown>, status: number, code: string) {
  return expect(promise).rejects.toMatchObject({ status, code });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  mocks.getTeamCoachLinks.mockResolvedValue({ ...teamLinks, cached: false });
  mocks.getOfficerLinks.mockResolvedValue(officerLinks);
  // Verified sessions are cached briefly, and every test here signs in with
  // the same bearer token - without this each test would be answered by the
  // previous one's identity.
  invalidateAll();
});

// ---------------------------------------------------------------------------
// normalizeEmail
// ---------------------------------------------------------------------------

describe("normalizeEmail", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeEmail("  player@hkfc.com  ")).toBe("player@hkfc.com");
  });

  it("lowercases the address", () => {
    expect(normalizeEmail("Coach@HKFC.COM")).toBe("coach@hkfc.com");
  });
});

// ---------------------------------------------------------------------------
// requireAuthorizedUser — access rules
// ---------------------------------------------------------------------------

describe("requireAuthorizedUser", () => {
  it("allows an active player with role 'player'", async () => {
    supabaseReturns("player@hkfc.com");
    mocks.getPlayerByEmail.mockResolvedValue(people.activePlayer);

    const user = await requireAuthorizedUser(authedRequest(), ENV);

    expect(user).toMatchObject({
      email: "player@hkfc.com",
      personId: "recP1",
      role: "player",
      coachTeams: [],
      isSectionCaptain: false,
      officerRoles: [],
    });
    expect(mocks.getPlayerByEmail).toHaveBeenCalledWith(ENV, "player@hkfc.com");
  });

  it("determines coach/section-captain status from the dedicated team-links lookup (all teams, active or not)", async () => {
    supabaseReturns("coach@hkfc.com");
    mocks.getPlayerByEmail.mockResolvedValue(people.activeCoach);

    await requireAuthorizedUser(authedRequest(), ENV);

    expect(mocks.getTeamCoachLinks).toHaveBeenCalledWith(ENV);
  });

  it("runs the People lookup and the team-links lookup in parallel after Supabase verification", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({ email: "player@hkfc.com" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
      mocks.getPlayerByEmail.mockImplementation(async () => {
        await delay(100);
        return people.activePlayer;
      });
      mocks.getTeamCoachLinks.mockImplementation(async () => {
        await delay(100);
        return { ...teamLinks, cached: false };
      });

      const pending = requireAuthorizedUser(authedRequest(), ENV);
      let settled = false;
      pending.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      // One 100ms tick must suffice for BOTH lookups when they run in
      // parallel; a sequential implementation would need a second tick.
      await vi.advanceTimersByTimeAsync(100);
      expect(settled).toBe(true);

      const user = await pending;
      expect(user.personId).toBe("recP1");
      expect(mocks.getPlayerByEmail).toHaveBeenCalled();
      expect(mocks.getTeamCoachLinks).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows an active coach linked via Teams.Coach with role 'coach'", async () => {
    supabaseReturns("coach@hkfc.com");
    mocks.getPlayerByEmail.mockResolvedValue(people.activeCoach);

    const user = await requireAuthorizedUser(authedRequest(), ENV);

    expect(user.role).toBe("coach");
    expect(user.coachTeams).toEqual(["Men's 1s"]);
    expect(user.isSectionCaptain).toBe(false);
  });

  it("allows an inactive coach linked via Teams.Coach (coach access does not depend on Active)", async () => {
    supabaseReturns("inactive-coach@hkfc.com");
    mocks.getPlayerByEmail.mockResolvedValue(people.inactiveCoach);

    const user = await requireAuthorizedUser(authedRequest(), ENV);

    expect(user).toMatchObject({ personId: "recInactiveCoach", role: "coach" });
  });

  it("allows a coach whose team has a blank Team Name (coach access is the link, not the derived name list)", async () => {
    supabaseReturns("unnamed-team-coach@hkfc.com");
    mocks.getPlayerByEmail.mockResolvedValue(people.unnamedTeamCoach);

    const user = await requireAuthorizedUser(authedRequest(), ENV);

    // Inactive and with no named teams to show, but still a coach: deriving
    // this from coachTeams.length would have denied them outright.
    expect(user).toMatchObject({ personId: "recUnnamedTeamCoach", role: "coach" });
    expect(user.coachTeams).toEqual([]);
  });

  it("allows an inactive section captain linked via Teams.Section Captain, and sees every team", async () => {
    supabaseReturns("captain@hkfc.com");
    mocks.getPlayerByEmail.mockResolvedValue(people.sectionCaptain);

    const user = await requireAuthorizedUser(authedRequest(), ENV);

    expect(user).toMatchObject({ personId: "recSectionCaptain", role: "coach", isSectionCaptain: true });
    // Section Captain is the most permissive path: every team, not just ones
    // they have an explicit Teams.Coach link on.
    expect(user.coachTeams).toEqual(teamLinks.allTeamNames);
  });

  it("does NOT grant coach access from People.Player/Coach alone (fallback removed)", async () => {
    supabaseReturns("fallback@hkfc.com");
    mocks.getPlayerByEmail.mockResolvedValue(people.playerCoachFlagOnly);

    // No Teams.Coach or Teams.Section Captain link, inactive, and the
    // Player/Coach multi-select says "Coach" - access must still be denied.
    await expectError(requireAuthorizedUser(authedRequest(), ENV), 403, "APPLICATION_ACCESS_DENIED");
  });

  it("allows an inactive membership officer, as a player not a coach", async () => {
    supabaseReturns("officer@personal.com");
    mocks.getPlayerByEmail.mockResolvedValue(people.membershipOfficer);

    const user = await requireAuthorizedUser(authedRequest(), ENV);

    // Holding an office is access, not coach access.
    expect(user).toMatchObject({ personId: "recOfficer", role: "player", coachTeams: [] });
    expect(user.officerRoles).toEqual([{ office: "membershipOfficer", designation: "Men's Membership Officer" }]);
    expect(mocks.getOfficerLinks).toHaveBeenCalledWith(ENV);
  });

  it("allows an inactive section chair", async () => {
    supabaseReturns("chair@personal.com");
    mocks.getPlayerByEmail.mockResolvedValue(people.chairman);

    const user = await requireAuthorizedUser(authedRequest(), ENV);

    expect(user.officerRoles).toEqual([{ office: "sectionChair", designation: "Chairman" }]);
  });

  it("gives a coach who also holds an office both", async () => {
    supabaseReturns("coach@hkfc.com");
    mocks.getPlayerByEmail.mockResolvedValue(people.activeCoach);

    const user = await requireAuthorizedUser(authedRequest(), ENV);

    expect(user.role).toBe("coach");
    expect(user.officerRoles).toEqual([{ office: "sectionChair", designation: "Men's Captain" }]);
  });

  it("denies an inactive ordinary player with 403 APPLICATION_ACCESS_DENIED", async () => {
    supabaseReturns("inactive@hkfc.com");
    mocks.getPlayerByEmail.mockResolvedValue(people.inactivePlayer);

    await expectError(requireAuthorizedUser(authedRequest(), ENV), 403, "APPLICATION_ACCESS_DENIED");
  });

  it("denies an email that does not exist in People with 403 APPLICATION_ACCESS_DENIED", async () => {
    supabaseReturns("stranger@example.com");
    mocks.getPlayerByEmail.mockResolvedValue(null);

    await expectError(requireAuthorizedUser(authedRequest(), ENV), 403, "APPLICATION_ACCESS_DENIED");
  });

  it("matches email case-insensitively against People", async () => {
    supabaseReturns("PLAYER@HKFC.COM");
    mocks.getPlayerByEmail.mockResolvedValue(people.activePlayer);

    await requireAuthorizedUser(authedRequest(), ENV);

    expect(mocks.getPlayerByEmail).toHaveBeenCalledWith(ENV, "player@hkfc.com");
  });

  it("normalizes whitespace before matching against People", async () => {
    supabaseReturns("  player@hkfc.com  ");
    mocks.getPlayerByEmail.mockResolvedValue(people.activePlayer);

    await requireAuthorizedUser(authedRequest(), ENV);

    expect(mocks.getPlayerByEmail).toHaveBeenCalledWith(ENV, "player@hkfc.com");
  });

  it("rejects an expired/invalid Supabase token with 401 UNAUTHORIZED", async () => {
    supabaseRejects();

    await expectError(requireAuthorizedUser(authedRequest("expired.token"), ENV), 401, "UNAUTHORIZED");
  });

  // The app signs a user out on 401, so only Supabase saying the token is
  // invalid may produce one. An outage or rate limit on Supabase's side is
  // not the user's session failing.
  it.each([500, 502, 503, 429])(
    "answers 503 AUTH_UNAVAILABLE, not 401, when Supabase itself returns %i",
    async (status) => {
      vi.mocked(fetch).mockImplementation(async () => new Response("upstream trouble", { status }));
      await expectError(requireAuthorizedUser(authedRequest(), ENV), 503, "AUTH_UNAVAILABLE");
    },
  );

  it("still answers 401 when Supabase says the token is forbidden", async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response("Forbidden", { status: 403 }));
    await expectError(requireAuthorizedUser(authedRequest(), ENV), 401, "UNAUTHORIZED");
  });

  it("rejects a missing Authorization header with 401 UNAUTHORIZED", async () => {
    const request = new Request("https://hkfc-api.test/api/my-profile");

    await expectError(requireAuthorizedUser(request, ENV), 401, "UNAUTHORIZED");
  });

  // Every authenticated route verifies first, so an uncached check put a
  // blocking round trip to Supabase in front of every request - and a screen
  // opening three endpoints at once paid for it three times.
  it("verifies a repeated token with Supabase only once", async () => {
    supabaseReturns("player@hkfc.com");
    mocks.getPlayerByEmail.mockResolvedValue(people.activePlayer);

    await requireAuthorizedUser(authedRequest(), ENV);
    await requireAuthorizedUser(authedRequest(), ENV);
    await requireAuthorizedUser(authedRequest(), ENV);

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("never answers one token with another token's identity", async () => {
    supabaseReturns("player@hkfc.com");
    mocks.getPlayerByEmail.mockResolvedValue(people.activePlayer);
    const first = await requireAuthorizedUser(authedRequest("token.one"), ENV);
    expect(first.email).toBe("player@hkfc.com");

    supabaseReturns("coach@hkfc.com");
    mocks.getPlayerByEmail.mockResolvedValue(people.activeCoach);
    const second = await requireAuthorizedUser(authedRequest("token.two"), ENV);

    expect(second.email).toBe("coach@hkfc.com");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("does not cache a rejected token", async () => {
    supabaseRejects();
    await expectError(requireAuthorizedUser(authedRequest(), ENV), 401, "UNAUTHORIZED");
    await expectError(requireAuthorizedUser(authedRequest(), ENV), 401, "UNAUTHORIZED");

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("rejects a session without an email with 401 UNAUTHORIZED", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: "no-email" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expectError(requireAuthorizedUser(authedRequest(), ENV), 401, "UNAUTHORIZED");
  });
});

// ---------------------------------------------------------------------------
// requireCoach — coach-only gate
// ---------------------------------------------------------------------------

describe("requireCoach", () => {
  it("denies an ordinary player with 403 COACH_ACCESS_REQUIRED", async () => {
    supabaseReturns("player@hkfc.com");
    mocks.getPlayerByEmail.mockResolvedValue(people.activePlayer);

    await expectError(requireCoach(authedRequest(), ENV), 403, "COACH_ACCESS_REQUIRED");
  });

  it("allows a coach through the coach-only gate", async () => {
    supabaseReturns("coach@hkfc.com");
    mocks.getPlayerByEmail.mockResolvedValue(people.activeCoach);

    const user = await requireCoach(authedRequest(), ENV);

    expect(user.role).toBe("coach");
  });

  it("keeps the COACH_ACCESS_REQUIRED code distinct from APPLICATION_ACCESS_DENIED", async () => {
    supabaseReturns("inactive@hkfc.com");
    mocks.getPlayerByEmail.mockResolvedValue(people.inactivePlayer);

    await expectError(requireCoach(authedRequest(), ENV), 403, "APPLICATION_ACCESS_DENIED");
  });
});

// ---------------------------------------------------------------------------
// Officers' sections (owner decision 2026-09-25)
//   membership: Membership Officers + Section Captains table
//   chairman:   Section Chairs + Section Captains table
// ---------------------------------------------------------------------------

describe("officers' sections", () => {
  it.each([
    ["a membership officer", "membershipOfficer", ["membership"]],
    ["a section chair", "chairman", ["chairman"]],
    ["a Section Captains row", "sectionCaptainRow", ["membership", "chairman"]],
    ["an ordinary player", "activePlayer", []],
    // Teams.Section Captain is coach access; it opens neither section.
    ["a Teams-linked section captain with no officer row", "sectionCaptain", []],
  ] as const)("%s sees %j", async (_label, who, expected) => {
    supabaseReturns(people[who].email);
    mocks.getPlayerByEmail.mockResolvedValue(people[who]);

    const user = await requireAuthorizedUser(authedRequest(), ENV);

    expect(sectionsFor(user)).toEqual(expected);
  });

  it("ignores Designation: a captain designation in Section Chairs opens only the chairman section", async () => {
    supabaseReturns("coach@hkfc.com");
    mocks.getPlayerByEmail.mockResolvedValue(people.activeCoach); // Section Chairs row, "Men's Captain"

    const user = await requireAuthorizedUser(authedRequest(), ENV);

    expect(sectionsFor(user)).toEqual(["chairman"]);
  });

  it("lets a membership officer into the membership section", async () => {
    supabaseReturns("officer@personal.com");
    mocks.getPlayerByEmail.mockResolvedValue(people.membershipOfficer);

    const user = await requireSection(authedRequest(), ENV, "membership");

    expect(user.personId).toBe("recOfficer");
  });

  it("keeps a membership officer out of the chairman section with 403 OFFICER_ACCESS_REQUIRED", async () => {
    supabaseReturns("officer@personal.com");
    mocks.getPlayerByEmail.mockResolvedValue(people.membershipOfficer);

    await expectError(requireSection(authedRequest(), ENV, "chairman"), 403, "OFFICER_ACCESS_REQUIRED");
  });

  it("keeps a section chair out of the membership section", async () => {
    supabaseReturns("chair@personal.com");
    mocks.getPlayerByEmail.mockResolvedValue(people.chairman);

    await expectError(requireSection(authedRequest(), ENV, "membership"), 403, "OFFICER_ACCESS_REQUIRED");
  });

  it("lets a Section Captains row into both", async () => {
    supabaseReturns("vice@personal.com");
    mocks.getPlayerByEmail.mockResolvedValue(people.sectionCaptainRow);

    await expect(requireSection(authedRequest(), ENV, "membership")).resolves.toMatchObject({ personId: "recCaptainRow" });
    await expect(requireSection(authedRequest(), ENV, "chairman")).resolves.toMatchObject({ personId: "recCaptainRow" });
  });
});
