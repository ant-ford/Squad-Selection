import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Route-level authorization + mode gating for the automatic re-registration
// endpoint (POST /api/registration/reconcile). The registration service is
// mocked here - worker behaviour is covered by tests/registration.test.ts.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  requireAuthorizedUser: vi.fn(),
  requireCoach: vi.fn(),
  reconcileRegistrations: vi.fn(),
}));

vi.mock("../worker/src/auth", () => ({
  requireAuthenticatedEmail: vi.fn(),
  requireAuthorizedUser: mocks.requireAuthorizedUser,
  requireCoach: mocks.requireCoach,
}));

// The registration service is the only real dependency of the new route;
// every other domain module must be stubbed so the router can boot.
vi.mock("../worker/src/registration", () => ({
  reconcileRegistrations: mocks.reconcileRegistrations,
}));
vi.mock("../worker/src/reference", () => ({ getReferenceData: vi.fn(), getActivePlayers: vi.fn(), getPlayerByEmail: vi.fn() }));
vi.mock("../worker/src/profile", () => ({ getMyProfile: vi.fn() }));
vi.mock("../worker/src/fixtures", () => ({ getMyFixtures: vi.fn(), getPlayerFixtures: vi.fn(), getUpcomingFixtures: vi.fn() }));
vi.mock("../worker/src/squad", () => ({
  getPlayersForMatch: vi.fn(),
  getSquadForMatch: vi.fn(),
  selectPlayer: vi.fn(),
  removeSelection: vi.fn(),
  getAvailabilityForMatch: vi.fn(),
  syncSquad: vi.fn(),
  toggleAutoSelect: vi.fn(),
  getTeamAutoSelectPlayers: vi.fn(),
  setTeamAutoSelectPlayers: vi.fn(),
}));
vi.mock("../worker/src/availability", () => ({ setAvailability: vi.fn(), setMyAvailability: vi.fn() }));
vi.mock("../worker/src/recommendations", () => ({ getRecommendationsForMatch: vi.fn() }));
vi.mock("../worker/src/calendar", () => ({
  handleGetCalendarLink: vi.fn(),
  handlePlayerCalendarFeed: vi.fn(),
  handleTeamCalendarExport: vi.fn(),
  handleGetTeamCalendarLink: vi.fn(),
  handleTeamCalendarFeed: vi.fn(),
}));
vi.mock("../worker/src/ranking", () => ({
  getActiveRanking: vi.fn(),
  getInactiveRanking: vi.fn(),
  getAbilityGroupConfig: vi.fn(),
  setAbilityGroupConfig: vi.fn(),
  movePlayerToRank: vi.fn(),
  movePlayerRelative: vi.fn(),
  reorderRanking: vi.fn(),
  activatePlayer: vi.fn(),
  deactivatePlayer: vi.fn(),
  initializeRanking: vi.fn(),
}));
vi.mock("../worker/src/metrics", () => ({ getEligibilityMetrics: vi.fn(), resetEligibilityMetrics: vi.fn() }));
vi.mock("../worker/src/dashboard", () => ({ getPlayUpWatch: vi.fn(), getRecentAvailability: vi.fn(), getRecentChanges: vi.fn() }));

import worker from "../worker/src/index";
import { HttpError } from "../worker/src/http";

const ENV = {
  AIRTABLE_TOKEN: "***",
  AIRTABLE_BASE_ID: "test-base",
  CALENDAR_SECRET: "***",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

const CTX = { waitUntil: () => {} } as any;

const REPORT = {
  mode: "dry-run",
  season: "2026-2027",
  scanned: 1,
  qualifyingPlayers: 1,
  alreadyProcessed: 0,
  plans: [],
  diagnostics: [],
};

function call(path: string, init?: RequestInit, env: any = ENV): Promise<Response> {
  return worker.fetch(new Request(`https://hkfc-api.test${path}`, init), env, CTX);
}

function post(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer valid.jwt.token" },
    body: JSON.stringify(body),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reconcileRegistrations.mockResolvedValue(REPORT);
});

describe("POST /api/registration/reconcile", () => {
  it("requires an authenticated session", async () => {
    mocks.requireCoach.mockRejectedValue(new HttpError("Missing Authorization header", 401, "UNAUTHORIZED"));
    const response = await call("/api/registration/reconcile", post({}));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("UNAUTHORIZED");
    expect(mocks.reconcileRegistrations).not.toHaveBeenCalled();
  });

  it("rejects non-coach sessions", async () => {
    mocks.requireCoach.mockRejectedValue(new HttpError("Coach access required.", 403, "COACH_ACCESS_REQUIRED"));
    const response = await call("/api/registration/reconcile", post({}));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("COACH_ACCESS_REQUIRED");
    expect(mocks.reconcileRegistrations).not.toHaveBeenCalled();
  });

  it("defaults to dry-run and never passes client-controlled scan inputs", async () => {
    mocks.requireAuthorizedUser.mockResolvedValue({ email: "c@hkfc.com", personId: "recCoach", role: "coach" });
    mocks.requireCoach.mockResolvedValue({ email: "c@hkfc.com", personId: "recCoach", role: "coach" });

    const response = await call("/api/registration/reconcile", post({
      mode: "dry-run",
      playerId: "recHACKED",
      destinationTeam: "A",
      triggeringMatchCard: "recHACKED",
    }));

    expect(response.status).toBe(200);
    expect(mocks.reconcileRegistrations).toHaveBeenCalledTimes(1);
    // Only the mode is taken from the body - no client input can influence
    // WHICH player or destination team is written (the scan is computed
    // entirely server-side from Match Cards).
    expect(mocks.reconcileRegistrations).toHaveBeenCalledWith(ENV, { mode: "dry-run" });
    const body = await response.json();
    expect(body.season).toBe("2026-2027");
  });

  it("rejects apply mode with 403 while AUTO_REGISTRATION_ENABLED is off", async () => {
    mocks.requireAuthorizedUser.mockResolvedValue({ email: "c@hkfc.com", personId: "recCoach", role: "coach" });
    mocks.requireCoach.mockResolvedValue({ email: "c@hkfc.com", personId: "recCoach", role: "coach" });

    const response = await call("/api/registration/reconcile", post({ mode: "apply" }));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("AUTO_REGISTRATION_DISABLED");
    expect(mocks.reconcileRegistrations).not.toHaveBeenCalled();
  });

  it("allows apply mode when AUTO_REGISTRATION_ENABLED=true", async () => {
    mocks.requireAuthorizedUser.mockResolvedValue({ email: "c@hkfc.com", personId: "recCoach", role: "coach" });
    mocks.requireCoach.mockResolvedValue({ email: "c@hkfc.com", personId: "recCoach", role: "coach" });

    const response = await call(
      "/api/registration/reconcile",
      post({ mode: "apply" }),
      { ...ENV, AUTO_REGISTRATION_ENABLED: "true" },
    );

    expect(response.status).toBe(200);
    expect(mocks.reconcileRegistrations).toHaveBeenCalledWith(
      expect.objectContaining({ AUTO_REGISTRATION_ENABLED: "true" }),
      { mode: "apply" },
    );
  });

  it("falls back to dry-run on a malformed JSON body", async () => {
    mocks.requireAuthorizedUser.mockResolvedValue({ email: "c@hkfc.com", personId: "recCoach", role: "coach" });
    mocks.requireCoach.mockResolvedValue({ email: "c@hkfc.com", personId: "recCoach", role: "coach" });

    const response = await call("/api/registration/reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer valid.jwt.token" },
      body: "{not json",
    });

    expect(response.status).toBe(200);
    expect(mocks.reconcileRegistrations).toHaveBeenCalledWith(ENV, { mode: "dry-run" });
  });
});

describe("scheduled reconciliation", () => {
  it("runs dry-run when AUTO_REGISTRATION_ENABLED is not set", async () => {
    await worker.scheduled(new Date("2026-08-28T18:00:00.000Z") as any, ENV, CTX);
    expect(mocks.reconcileRegistrations).toHaveBeenCalledWith(ENV, { mode: "dry-run" });
  });

  it("runs apply when AUTO_REGISTRATION_ENABLED=true", async () => {
    await worker.scheduled(
      new Date("2026-08-28T18:00:00.000Z") as any,
      { ...ENV, AUTO_REGISTRATION_ENABLED: "true" } as any,
      CTX,
    );
    expect(mocks.reconcileRegistrations).toHaveBeenCalledWith(
      expect.objectContaining({ AUTO_REGISTRATION_ENABLED: "true" }),
      { mode: "apply" },
    );
  });

  it("never throws when the reconciliation fails", async () => {
    mocks.reconcileRegistrations.mockRejectedValue(new Error("Airtable down"));
    await expect(
      worker.scheduled(new Date("2026-08-28T18:00:00.000Z") as any, ENV, CTX),
    ).resolves.toBeUndefined();
  });
});
