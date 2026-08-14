import { describe, it, expect, vi, beforeEach } from "vitest";

// Integration tests for the Worker router (worker/src/index.ts).
// All domain modules are mocked; the auth module is stubbed so each test can
// control what the verified session resolves to. These tests prove the router
// derives identity from the session (never from query/body params) and applies
// the right error codes.

const mocks = vi.hoisted(() => {
  const authorizedPlayer = { email: "player@hkfc.com", personId: "recP1", role: "player" as const };
  const authorizedCoach = { email: "coach@hkfc.com", personId: "recCoach", role: "coach" as const };
  return {
    authorizedPlayer,
    authorizedCoach,
    requireAuthenticatedEmail: vi.fn(),
    requireAuthorizedUser: vi.fn(),
    requireCoach: vi.fn(),
    getReferenceData: vi.fn(),
    getActivePlayers: vi.fn(),
    getPlayerByEmail: vi.fn(),
    getMyProfile: vi.fn(),
    getMyFixtures: vi.fn(),
    getPlayerFixtures: vi.fn(),
    getUpcomingFixtures: vi.fn(),
    getPlayersForMatch: vi.fn(),
    getSquadForMatch: vi.fn(),
    selectPlayer: vi.fn(),
    removeSelection: vi.fn(),
    getAvailabilityForMatch: vi.fn(),
    syncSquad: vi.fn(),
    toggleAutoSelect: vi.fn(),
    getTeamAutoSelectPlayers: vi.fn(),
    setTeamAutoSelectPlayers: vi.fn(),
    setAvailability: vi.fn(),
    setMyAvailability: vi.fn(),
    getRecommendationsForMatch: vi.fn(),
    handleGetCalendarLink: vi.fn(),
    handlePlayerCalendarFeed: vi.fn(),
    handleTeamCalendarExport: vi.fn(),
    handleGetTeamCalendarLink: vi.fn(),
    handleTeamCalendarFeed: vi.fn(),
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
    getEligibilityMetrics: vi.fn(),
    resetEligibilityMetrics: vi.fn(),
    getPlayUpWatch: vi.fn(),
    getRecentAvailability: vi.fn(),
    getRecentChanges: vi.fn(),
  };
});

vi.mock("../worker/src/auth", () => ({
  requireAuthenticatedEmail: mocks.requireAuthenticatedEmail,
  requireAuthorizedUser: mocks.requireAuthorizedUser,
  requireCoach: mocks.requireCoach,
}));

vi.mock("../worker/src/reference", () => ({
  getReferenceData: mocks.getReferenceData,
  getActivePlayers: mocks.getActivePlayers,
  getPlayerByEmail: mocks.getPlayerByEmail,
}));

vi.mock("../worker/src/profile", () => ({ getMyProfile: mocks.getMyProfile }));
vi.mock("../worker/src/fixtures", () => ({
  getMyFixtures: mocks.getMyFixtures,
  getPlayerFixtures: mocks.getPlayerFixtures,
  getUpcomingFixtures: mocks.getUpcomingFixtures,
}));
vi.mock("../worker/src/squad", () => ({
  getPlayersForMatch: mocks.getPlayersForMatch,
  getSquadForMatch: mocks.getSquadForMatch,
  selectPlayer: mocks.selectPlayer,
  removeSelection: mocks.removeSelection,
  getAvailabilityForMatch: mocks.getAvailabilityForMatch,
  syncSquad: mocks.syncSquad,
  toggleAutoSelect: mocks.toggleAutoSelect,
  getTeamAutoSelectPlayers: mocks.getTeamAutoSelectPlayers,
  setTeamAutoSelectPlayers: mocks.setTeamAutoSelectPlayers,
}));
vi.mock("../worker/src/availability", () => ({
  setAvailability: mocks.setAvailability,
  setMyAvailability: mocks.setMyAvailability,
}));
vi.mock("../worker/src/recommendations", () => ({
  getRecommendationsForMatch: mocks.getRecommendationsForMatch,
}));
vi.mock("../worker/src/calendar", () => ({
  handleGetCalendarLink: mocks.handleGetCalendarLink,
  handlePlayerCalendarFeed: mocks.handlePlayerCalendarFeed,
  handleTeamCalendarExport: mocks.handleTeamCalendarExport,
  handleGetTeamCalendarLink: mocks.handleGetTeamCalendarLink,
  handleTeamCalendarFeed: mocks.handleTeamCalendarFeed,
}));
vi.mock("../worker/src/ranking", () => ({
  getActiveRanking: mocks.getActiveRanking,
  getInactiveRanking: mocks.getInactiveRanking,
  getAbilityGroupConfig: mocks.getAbilityGroupConfig,
  setAbilityGroupConfig: mocks.setAbilityGroupConfig,
  movePlayerToRank: mocks.movePlayerToRank,
  movePlayerRelative: mocks.movePlayerRelative,
  reorderRanking: mocks.reorderRanking,
  activatePlayer: mocks.activatePlayer,
  deactivatePlayer: mocks.deactivatePlayer,
  initializeRanking: mocks.initializeRanking,
}));
vi.mock("../worker/src/metrics", () => ({
  getEligibilityMetrics: mocks.getEligibilityMetrics,
  resetEligibilityMetrics: mocks.resetEligibilityMetrics,
}));
vi.mock("../worker/src/dashboard", () => ({
  getPlayUpWatch: mocks.getPlayUpWatch,
  getRecentAvailability: mocks.getRecentAvailability,
  getRecentChanges: mocks.getRecentChanges,
}));

import worker from "../worker/src/index";
import { HttpError } from "../worker/src/http";

const ENV = {
  AIRTABLE_TOKEN: "test-token",
  AIRTABLE_BASE_ID: "test-base",
  CALENDAR_SECRET: "test-secret",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "test-anon-key",
} as any;

const CTX = { waitUntil: () => {} } as any;

function call(path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`https://hkfc-api.test${path}`, init), ENV, CTX);
}

function jsonInit(body: unknown, token = "valid.jwt.token"): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  };
}

const coachDenied = () =>
  new HttpError("Coach access required.", 403, "COACH_ACCESS_REQUIRED");

beforeEach(() => {
  vi.clearAllMocks();
  // Defaults: an authorized ordinary player; coach-only routes reject.
  mocks.requireAuthorizedUser.mockResolvedValue(mocks.authorizedPlayer);
  mocks.requireAuthenticatedEmail.mockResolvedValue("player@hkfc.com");
  mocks.requireCoach.mockRejectedValue(coachDenied());

  mocks.getMyProfile.mockResolvedValue({
    preferredName: "Test Player", roles: [], isCoach: false, isSectionCaptain: false, captainTeams: [], coachTeams: [],
  });
  mocks.getMyFixtures.mockResolvedValue({
    playerName: "Test Player", registeredTeam: "Men's 3s", playingPosition: "",
    shirtNoValue: "", isCoach: false, coachTeams: [], captainTeams: [],
    isSectionCaptain: false, fixtures: [], eligibleOtherFixtures: [],
  });
  mocks.getUpcomingFixtures.mockResolvedValue({ fixtures: [] });
  mocks.setMyAvailability.mockResolvedValue({ success: true, exceptionId: null });
  mocks.toggleAutoSelect.mockResolvedValue({ success: true });
  mocks.syncSquad.mockResolvedValue({ success: true });
  mocks.setTeamAutoSelectPlayers.mockResolvedValue({ success: true });
  mocks.getTeamAutoSelectPlayers.mockResolvedValue({ players: [] });
  mocks.movePlayerToRank.mockResolvedValue({ players: [], activeCount: 0, config: {} });
});

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

describe("error codes", () => {
  it("returns 401 UNAUTHORIZED for an expired/invalid session", async () => {
    mocks.requireAuthorizedUser.mockRejectedValue(
      new HttpError("Invalid or expired session", 401, "UNAUTHORIZED"),
    );

    const res = await call("/api/my-profile");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "UNAUTHORIZED" });
  });

  it("returns 403 APPLICATION_ACCESS_DENIED for a denied user", async () => {
    mocks.requireAuthorizedUser.mockRejectedValue(
      new HttpError("Application access is not authorised.", 403, "APPLICATION_ACCESS_DENIED"),
    );

    const res = await call("/api/my-fixtures");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "APPLICATION_ACCESS_DENIED" });
  });

  it("returns 403 COACH_ACCESS_REQUIRED when a player hits a coach-only route", async () => {
    const res = await call("/api/ranking/move", jsonInit({ playerId: "recP9", newRank: 1 }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "COACH_ACCESS_REQUIRED" });
  });
});

// ---------------------------------------------------------------------------
// IDOR: identity must come from the session, never from query/body params
// ---------------------------------------------------------------------------

describe("session-derived identity (IDOR prevention)", () => {
  it("GET /api/my-profile ignores a ?email= query param", async () => {
    const res = await call("/api/my-profile?email=attacker@evil.com");
    expect(res.status).toBe(200);
    expect(mocks.getMyProfile).toHaveBeenCalledWith(ENV, "player@hkfc.com");
  });

  it("GET /api/my-fixtures ignores a ?email= query param", async () => {
    const res = await call("/api/my-fixtures?email=attacker@evil.com");
    expect(res.status).toBe(200);
    expect(mocks.getMyFixtures).toHaveBeenCalledWith(ENV, "player@hkfc.com");
  });

  it("GET /api/upcoming-fixtures scopes by the session email, ignoring ?email=", async () => {
    const res = await call("/api/upcoming-fixtures?email=attacker@evil.com&team=Men's%201s");
    expect(res.status).toBe(200);
    expect(mocks.getUpcomingFixtures).toHaveBeenCalledWith(ENV, {
      email: "player@hkfc.com",
      team: "Men's 1s",
    });
  });

  it("POST /api/set-my-availability cannot target another person via body.email", async () => {
    const res = await call(
      "/api/set-my-availability",
      jsonInit({ email: "attacker@evil.com", matchId: "recM1", status: "Unavailable" }),
    );
    expect(res.status).toBe(200);
    expect(mocks.setMyAvailability).toHaveBeenCalledWith(
      ENV,
      expect.objectContaining({ email: "player@hkfc.com", matchId: "recM1" }),
    );
  });

  it("GET /api/calendar/link derives the player from the session, ignoring ?email=", async () => {
    mocks.handleGetCalendarLink.mockResolvedValue({ id: "recP1", sig: "abc" });
    const res = await call("/api/calendar/link?email=attacker@evil.com");
    expect(res.status).toBe(200);
    expect(mocks.handleGetCalendarLink).toHaveBeenCalledWith(ENV, "player@hkfc.com");
  });
});

// ---------------------------------------------------------------------------
// Coach-only routes
// ---------------------------------------------------------------------------

describe("coach-only routes", () => {
  const coachOnlyCalls: { path: string; init: RequestInit }[] = [
    { path: "/api/ranking/config", init: jsonInit({ config: { A: 1, B: 1, C: 1, D: 1, E: 1, F: 1, G: 1 } }) },
    { path: "/api/ranking/move", init: jsonInit({ playerId: "recP9", newRank: 1 }) },
    { path: "/api/ranking/move-relative", init: jsonInit({ sourceId: "a", targetId: "b", position: "above" }) },
    { path: "/api/ranking/reorder", init: jsonInit({ playerIds: ["a", "b"] }) },
    { path: "/api/ranking/activate", init: jsonInit({ playerId: "recP9" }) },
    { path: "/api/ranking/deactivate", init: jsonInit({ playerId: "recP9" }) },
    { path: "/api/ranking/initialize", init: jsonInit({}) },
    { path: "/api/ranking/backfill", init: jsonInit({}) },
    { path: "/squad/sync", init: jsonInit({ matchId: "recM1", selectedIds: ["a"] }) },
    { path: "/api/select-player", init: jsonInit({ matchId: "recM1", playerId: "a" }) },
    { path: "/api/remove-selection", init: jsonInit({ matchId: "recM1", playerId: "a" }) },
    { path: "/api/set-availability", init: jsonInit({ playerId: "a", matchIds: ["recM1"], status: "Available" }) },
    { path: "/api/team/auto-select-players", init: jsonInit({ teamName: "Men's 1s", playerIds: [] }) },
    { path: "/api/match/recM1/auto-select", init: jsonInit({ enabled: true }) },
  ];

  it.each(coachOnlyCalls)("blocks a player from $path with COACH_ACCESS_REQUIRED", async ({ path, init }) => {
    const res = await call(path, init);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "COACH_ACCESS_REQUIRED" });
  });

  it("allows a coach on POST /api/ranking/move and uses the session email for audit", async () => {
    mocks.requireCoach.mockResolvedValue(mocks.authorizedCoach);

    const res = await call(
      "/api/ranking/move",
      jsonInit({ playerId: "recP9", newRank: 1, actingEmail: "attacker@evil.com" }),
    );
    expect(res.status).toBe(200);
    expect(mocks.movePlayerToRank).toHaveBeenCalledWith(ENV, "recP9", 1, "coach@hkfc.com", undefined);
  });

  it("passes the optional justification note through on ranking writes", async () => {
    mocks.requireCoach.mockResolvedValue(mocks.authorizedCoach);
    mocks.movePlayerToRank.mockResolvedValue({ players: [], activeCount: 0, config: {} });
    mocks.movePlayerRelative.mockResolvedValue({ players: [], activeCount: 0, config: {} });
    mocks.reorderRanking.mockResolvedValue({ players: [], activeCount: 0, config: {} });

    await call(
      "/api/ranking/move",
      jsonInit({ playerId: "recP9", newRank: 4, justification: "needs more game time" }),
    );
    expect(mocks.movePlayerToRank).toHaveBeenLastCalledWith(
      ENV,
      "recP9",
      4,
      "coach@hkfc.com",
      "needs more game time",
    );

    await call(
      "/api/ranking/move-relative",
      jsonInit({ sourceId: "recP9", targetId: "recP8", position: "above", justification: "form" }),
    );
    expect(mocks.movePlayerRelative).toHaveBeenLastCalledWith(
      ENV,
      "recP9",
      "recP8",
      "above",
      "coach@hkfc.com",
      "form",
    );

    await call(
      "/api/ranking/reorder",
      jsonInit({ playerIds: ["recP9", "recP8"], justification: "bulk reorder" }),
    );
    expect(mocks.reorderRanking).toHaveBeenLastCalledWith(
      ENV,
      ["recP9", "recP8"],
      "coach@hkfc.com",
      "bulk reorder",
    );

    // Without a note the argument is simply absent.
    await call("/api/ranking/reorder", jsonInit({ playerIds: ["recP9", "recP8"] }));
    expect(mocks.reorderRanking).toHaveBeenLastCalledWith(
      ENV,
      ["recP9", "recP8"],
      "coach@hkfc.com",
      undefined,
    );
  });

  it("allows a coach on POST /squad/sync and uses the session email, ignoring body actingEmail", async () => {
    mocks.requireCoach.mockResolvedValue(mocks.authorizedCoach);

    const res = await call(
      "/squad/sync",
      jsonInit({ matchId: "recM1", selectedIds: ["a", "b"], actingEmail: "attacker@evil.com", side: "home" }),
    );
    expect(res.status).toBe(200);
    expect(mocks.syncSquad).toHaveBeenCalledWith(ENV, "recM1", ["a", "b"], "coach@hkfc.com", "home");
  });

  it("allows a coach on POST /api/team/auto-select-players and uses the session email", async () => {
    mocks.requireCoach.mockResolvedValue(mocks.authorizedCoach);

    const res = await call(
      "/api/team/auto-select-players",
      jsonInit({ teamName: "Men's 1s", playerIds: ["a"], actingEmail: "attacker@evil.com" }),
    );
    expect(res.status).toBe(200);
    expect(mocks.setTeamAutoSelectPlayers).toHaveBeenCalledWith(ENV, "Men's 1s", ["a"], "coach@hkfc.com");
  });

  it("allows a coach on POST /api/match/:id/auto-select and uses the session email", async () => {
    mocks.requireCoach.mockResolvedValue(mocks.authorizedCoach);

    const res = await call(
      "/api/match/recM1/auto-select",
      jsonInit({ enabled: true, actingEmail: "attacker@evil.com" }),
    );
    expect(res.status).toBe(200);
    expect(mocks.toggleAutoSelect).toHaveBeenCalledWith(ENV, "recM1", true, "coach@hkfc.com");
  });

  it("GET /api/team/auto-select-players requires coach role", async () => {
    const res = await call("/api/team/auto-select-players?team=Men's%201s");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "COACH_ACCESS_REQUIRED" });
  });

  it("GET /api/player-by-email (coach lookup of another person) requires coach role", async () => {
    const res = await call("/api/player-by-email?email=someone@hkfc.com");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "COACH_ACCESS_REQUIRED" });
  });
});

// ---------------------------------------------------------------------------
// Authorized-user (non-coach) reads
// ---------------------------------------------------------------------------

describe("authorized-user reads", () => {
  it("allows an authorized player on GET /api/reference-data", async () => {
    mocks.getReferenceData.mockResolvedValue({ players: [], teams: [], teamRankMap: {}, teamNames: [] });
    const res = await call("/api/reference-data");
    expect(res.status).toBe(200);
    expect(mocks.requireAuthorizedUser).toHaveBeenCalled();
  });

  it("GET /api/calendar/team-link passes the session email and keeps the team param", async () => {
    mocks.handleGetTeamCalendarLink.mockResolvedValue({ team: "Men's 1s", sig: "abc" });
    const res = await call("/api/calendar/team-link?team=Men's%201s");
    expect(res.status).toBe(200);
    expect(mocks.handleGetTeamCalendarLink).toHaveBeenCalledWith(ENV, "player@hkfc.com", "Men's 1s");
  });
});

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

describe("misc routing", () => {
  it("returns NOT_FOUND for unknown routes", async () => {
    const res = await call("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "NOT_FOUND" });
  });

  it("keeps /health public", async () => {
    const res = await call("/health");
    expect(res.status).toBe(200);
  });
});
