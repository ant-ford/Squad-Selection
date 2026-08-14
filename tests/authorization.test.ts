import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Airtable access layer so the auth engine is tested in isolation.
const mocks = vi.hoisted(() => ({
  getPlayerByEmail: vi.fn(),
  getTeamCoachLinks: vi.fn(),
}));

vi.mock("../worker/src/reference", () => ({
  getPlayerByEmail: mocks.getPlayerByEmail,
  getTeamCoachLinks: mocks.getTeamCoachLinks,
}));

import { requireAuthorizedUser, requireCoach, normalizeEmail } from "../worker/src/auth";
import { HttpError } from "../worker/src/http";

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
  coachIds: ["recCoach", "recInactiveCoach"],
  sectionCaptainIds: ["recSectionCaptain"],
};

const people = {
  activePlayer: { id: "recP1", email: "player@hkfc.com", active: true, playerCoach: [] },
  inactivePlayer: { id: "recP2", email: "inactive@hkfc.com", active: false, playerCoach: [] },
  activeCoach: { id: "recCoach", email: "coach@hkfc.com", active: true, playerCoach: [] },
  inactiveCoach: { id: "recInactiveCoach", email: "inactive-coach@hkfc.com", active: false, playerCoach: [] },
  sectionCaptain: { id: "recSectionCaptain", email: "captain@hkfc.com", active: false, playerCoach: [] },
  fallbackCoach: { id: "recFallback", email: "fallback@hkfc.com", active: false, playerCoach: ["Player/Coach"] },
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

function supabaseRejects() {
  vi.mocked(fetch).mockResolvedValue(new Response("Unauthorized", { status: 401 }));
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

    expect(user).toMatchObject({ email: "player@hkfc.com", personId: "recP1", role: "player" });
    expect(mocks.getPlayerByEmail).toHaveBeenCalledWith(ENV, "player@hkfc.com", { fresh: true });
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
      // Telemetry contract: the mocked team-links lookup reports its cache
      // status, and the returned user carries the auth-phase breakdown.
      expect(user.perf?.coachLinksFromCache).toBe(false);
      expect(typeof user.perf?.coachLinksMs).toBe("number");
      expect(typeof user.perf?.playerMs).toBe("number");
      expect(typeof user.perf?.supabaseMs).toBe("number");
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows an active coach linked via Teams.Coach with role 'coach'", async () => {
    supabaseReturns("coach@hkfc.com");
    mocks.getPlayerByEmail.mockResolvedValue(people.activeCoach);

    const user = await requireAuthorizedUser(authedRequest(), ENV);

    expect(user.role).toBe("coach");
  });

  it("allows an inactive coach linked via Teams.Coach (coach access does not depend on Active)", async () => {
    supabaseReturns("inactive-coach@hkfc.com");
    mocks.getPlayerByEmail.mockResolvedValue(people.inactiveCoach);

    const user = await requireAuthorizedUser(authedRequest(), ENV);

    expect(user).toMatchObject({ personId: "recInactiveCoach", role: "coach" });
  });

  it("allows an inactive section captain linked via Teams.Section Captain", async () => {
    supabaseReturns("captain@hkfc.com");
    mocks.getPlayerByEmail.mockResolvedValue(people.sectionCaptain);

    const user = await requireAuthorizedUser(authedRequest(), ENV);

    expect(user).toMatchObject({ personId: "recSectionCaptain", role: "coach" });
  });

  it("allows an inactive person whose People.Player/Coach flag contains Coach (fallback safeguard)", async () => {
    supabaseReturns("fallback@hkfc.com");
    mocks.getPlayerByEmail.mockResolvedValue(people.fallbackCoach);

    const user = await requireAuthorizedUser(authedRequest(), ENV);

    expect(user).toMatchObject({ personId: "recFallback", role: "coach" });
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

    expect(mocks.getPlayerByEmail).toHaveBeenCalledWith(ENV, "player@hkfc.com", { fresh: true });
  });

  it("normalizes whitespace before matching against People", async () => {
    supabaseReturns("  player@hkfc.com  ");
    mocks.getPlayerByEmail.mockResolvedValue(people.activePlayer);

    await requireAuthorizedUser(authedRequest(), ENV);

    expect(mocks.getPlayerByEmail).toHaveBeenCalledWith(ENV, "player@hkfc.com", { fresh: true });
  });

  it("rejects an expired/invalid Supabase token with 401 UNAUTHORIZED", async () => {
    supabaseRejects();

    await expectError(requireAuthorizedUser(authedRequest("expired.token"), ENV), 401, "UNAUTHORIZED");
  });

  it("rejects a missing Authorization header with 401 UNAUTHORIZED", async () => {
    const request = new Request("https://hkfc-api.test/api/my-profile");

    await expectError(requireAuthorizedUser(request, ENV), 401, "UNAUTHORIZED");
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
