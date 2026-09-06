import { describe, it, expect, vi, beforeEach } from "vitest";

// Integration tests for the Worker router (worker/src/index.ts).
// All domain modules are mocked; the auth module is stubbed so each test can
// control what the verified session resolves to. These tests prove the router
// derives identity from the session (never from query/body params) and applies
// the right error codes.

const mocks = vi.hoisted(() => {
  const authorizedPlayer = { email: "player@hkfc.com", personId: "recP1", role: "player" as const, coachTeams: [], isSectionCaptain: false };
  const authorizedCoach = { email: "coach@hkfc.com", personId: "recCoach", role: "coach" as const, coachTeams: ["Men's 1s"], isSectionCaptain: false };
  return {
    authorizedPlayer,
    authorizedCoach,
    requireAuthorizedUser: vi.fn(),
    requireCoach: vi.fn(),
    getMyProfile: vi.fn(),
    getMyFixtures: vi.fn(),
    getUpcomingFixtures: vi.fn(),
    getPlayersForMatch: vi.fn(),
    getSquadForMatch: vi.fn(),
    getAvailabilityForMatch: vi.fn(),
    syncSquad: vi.fn(),
    getPlayerSeasonStats: vi.fn(),
    setMatchKit: vi.fn(),
    toggleAutoSelect: vi.fn(),
    getTeamAutoSelectPlayers: vi.fn(),
    setTeamAutoSelectPlayers: vi.fn(),
    setMyAvailability: vi.fn(),
    setMyAvailabilityForDate: vi.fn(),
    getRecommendationsForMatch: vi.fn(),
    handleGetCalendarLink: vi.fn(),
    handlePlayerCalendarFeed: vi.fn(),
    handleGetTeamCalendarLink: vi.fn(),
    handleTeamCalendarFeed: vi.fn(),
    getActiveRanking: vi.fn(),
    getInactiveRanking: vi.fn(),
    setAbilityGroupConfig: vi.fn(),
    movePlayerToRank: vi.fn(),
    movePlayerRelative: vi.fn(),
    reorderRanking: vi.fn(),
    activatePlayer: vi.fn(),
    deactivatePlayer: vi.fn(),
    getPlayUpWatch: vi.fn(),
    getRecentChanges: vi.fn(),
  };
});

vi.mock("../worker/src/auth", () => ({
  requireAuthorizedUser: mocks.requireAuthorizedUser,
  requireCoach: mocks.requireCoach,
}));

vi.mock("../worker/src/profile", () => ({ getMyProfile: mocks.getMyProfile }));
vi.mock("../worker/src/fixtures", () => ({
  getMyFixtures: mocks.getMyFixtures,
  getUpcomingFixtures: mocks.getUpcomingFixtures,
}));
vi.mock("../worker/src/squad", () => ({
  getPlayersForMatch: mocks.getPlayersForMatch,
  getSquadForMatch: mocks.getSquadForMatch,
  getAvailabilityForMatch: mocks.getAvailabilityForMatch,
  syncSquad: mocks.syncSquad,
  setMatchKit: mocks.setMatchKit,
  toggleAutoSelect: mocks.toggleAutoSelect,
  getTeamAutoSelectPlayers: mocks.getTeamAutoSelectPlayers,
  setTeamAutoSelectPlayers: mocks.setTeamAutoSelectPlayers,
}));
vi.mock("../worker/src/availability", () => ({
  setMyAvailability: mocks.setMyAvailability,
  setMyAvailabilityForDate: mocks.setMyAvailabilityForDate,
}));
vi.mock("../worker/src/recommendations", () => ({
  getRecommendationsForMatch: mocks.getRecommendationsForMatch,
}));
vi.mock("../worker/src/calendar", () => ({
  handleGetCalendarLink: mocks.handleGetCalendarLink,
  handlePlayerCalendarFeed: mocks.handlePlayerCalendarFeed,
  handleGetTeamCalendarLink: mocks.handleGetTeamCalendarLink,
  handleTeamCalendarFeed: mocks.handleTeamCalendarFeed,
}));
vi.mock("../worker/src/ranking", () => ({
  getActiveRanking: mocks.getActiveRanking,
  getInactiveRanking: mocks.getInactiveRanking,
  setAbilityGroupConfig: mocks.setAbilityGroupConfig,
  movePlayerToRank: mocks.movePlayerToRank,
  movePlayerRelative: mocks.movePlayerRelative,
  reorderRanking: mocks.reorderRanking,
  activatePlayer: mocks.activatePlayer,
  deactivatePlayer: mocks.deactivatePlayer,
}));
vi.mock("../worker/src/playerStats", () => ({ getPlayerSeasonStats: mocks.getPlayerSeasonStats }));
vi.mock("../worker/src/dashboard", () => ({
  getPlayUpWatch: mocks.getPlayUpWatch,
  getRecentChanges: mocks.getRecentChanges,
}));

import worker from "../worker/src/index";
import { HttpError } from "../worker/src/http";
import { AirtableError } from "../worker/src/airtable";

const ENV = {
  AIRTABLE_TOKEN: "test-token",
  AIRTABLE_BASE_ID: "test-base",
  CALENDAR_SECRET: "test-secret",
  ALLOWED_ORIGIN: "https://hkfc-squad-selection.test",
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

// ---------------------------------------------------------------------------
// Availability identity boundary - the browser never controls the identity of
// a "my availability" write. The Worker derives it from the verified session.
// ---------------------------------------------------------------------------

describe("availability identity boundary", () => {
  it("ignores client-supplied email/playerId - identity comes from the session", async () => {
    mocks.requireAuthorizedUser.mockResolvedValue({ email: "player@hkfc.com", personId: "recP1", role: "player" });
    mocks.setMyAvailability.mockResolvedValue({ success: true, exceptionId: null });

    const response = await call("/api/set-my-availability", jsonInit({
      matchId: "recM1",
      status: "Unavailable",
      email: "attacker@example.com",
      playerId: "recAttacker",
    }));

    expect(response.status).toBe(200);
    expect(mocks.setMyAvailability).toHaveBeenCalledTimes(1);
    const input = mocks.setMyAvailability.mock.calls[0][1];
    expect(input.email).toBe("player@hkfc.com"); // session email, never the attacker's
    expect(input.playerId).toBeUndefined(); // client identity fields are dropped
  });

  it("rejects unauthenticated availability writes with 401", async () => {
    mocks.requireAuthorizedUser.mockRejectedValue(new HttpError("Missing Authorization header", 401, "UNAUTHORIZED"));
    const response = await call("/api/set-my-availability", jsonInit({ matchId: "recM1", status: "Unavailable" }));
    expect(response.status).toBe(401);
    expect(mocks.setMyAvailability).not.toHaveBeenCalled();
  });

  it("bulk date-level endpoint also ignores client-supplied identity", async () => {
    mocks.requireAuthorizedUser.mockResolvedValue({ email: "gk-a@example.com", personId: "recGKA", role: "player" });
    mocks.setMyAvailabilityForDate.mockResolvedValue({ success: true, updated: 0, results: [] });

    const response = await call("/api/set-my-availability-for-date", jsonInit({
      date: "2026-09-05",
      status: "Available",
      email: "someone-else@example.com",
    }));

    expect(response.status).toBe(200);
    const input = mocks.setMyAvailabilityForDate.mock.calls[0][1];
    expect(input.email).toBe("gk-a@example.com"); // session identity only
    expect(input.date).toBe("2026-09-05");
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  // Defaults: an authorized ordinary player; coach-only routes reject.
  mocks.requireAuthorizedUser.mockResolvedValue(mocks.authorizedPlayer);
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

  it("maps an AirtableError to a generic 502 without leaking the Airtable URL or response body", async () => {
    mocks.getMyProfile.mockRejectedValue(
      new AirtableError(
        "Airtable GET https://api.airtable.com/v0/appSecretBase123/People?filterByFormula=... failed (500): {\"error\":{\"message\":\"internal\"}}",
        500,
      ),
    );

    const res = await call("/api/my-profile");
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body).toMatchObject({ error: "UPSTREAM_ERROR" });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("api.airtable.com");
    expect(serialized).not.toContain("appSecretBase123");
  });
});

// ---------------------------------------------------------------------------
// IDOR: identity must come from the session, never from query/body params
// ---------------------------------------------------------------------------

describe("session-derived identity (IDOR prevention)", () => {
  it("GET /api/my-profile ignores a ?email= query param", async () => {
    const res = await call("/api/my-profile?email=attacker@evil.com");
    expect(res.status).toBe(200);
    expect(mocks.getMyProfile).toHaveBeenCalledWith(ENV, mocks.authorizedPlayer);
  });

  it("GET /api/my-fixtures ignores a ?email= query param", async () => {
    const res = await call("/api/my-fixtures?email=attacker@evil.com");
    expect(res.status).toBe(200);
    expect(mocks.getMyFixtures).toHaveBeenCalledWith(ENV, mocks.authorizedPlayer);
  });

  it("GET /api/upcoming-fixtures scopes by the session email, ignoring ?email=", async () => {
    const res = await call("/api/upcoming-fixtures?email=attacker@evil.com&team=Men's%201s");
    expect(res.status).toBe(200);
    expect(mocks.getUpcomingFixtures).toHaveBeenCalledWith(ENV, {
      user: mocks.authorizedPlayer,
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
    mocks.handleGetCalendarLink.mockResolvedValue({ url: "https://hkfc-api.test/api/calendar/feed.ics?id=recP1&sig=abc" });
    const res = await call("/api/calendar/link?email=attacker@evil.com");
    expect(res.status).toBe(200);
    expect(mocks.handleGetCalendarLink).toHaveBeenCalledWith(ENV, "player@hkfc.com", "https://hkfc-api.test");
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
    { path: "/api/squad/sync", init: jsonInit({ matchId: "recM1", selectedIds: ["a"] }) },
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

  it("allows a coach on POST /api/squad/sync and uses the session email, ignoring body actingEmail", async () => {
    mocks.requireCoach.mockResolvedValue(mocks.authorizedCoach);

    const res = await call(
      "/api/squad/sync",
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
});

// ---------------------------------------------------------------------------
// Authorized-user (non-coach) reads
// ---------------------------------------------------------------------------

describe("authorized-user reads", () => {
  it("GET /api/calendar/team-link passes the session email and keeps the team param", async () => {
    mocks.handleGetTeamCalendarLink.mockResolvedValue({ url: "https://hkfc-api.test/api/calendar/team-feed.ics?team=Men's%201s&sig=abc" });
    const res = await call("/api/calendar/team-link?team=Men's%201s");
    expect(res.status).toBe(200);
    expect(mocks.handleGetTeamCalendarLink).toHaveBeenCalledWith(ENV, mocks.authorizedPlayer, "Men's 1s", "https://hkfc-api.test");
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

  it("fails closed with 500 when ALLOWED_ORIGIN is not configured, even for /health", async () => {
    const misconfiguredEnv = { ...ENV, ALLOWED_ORIGIN: "" };
    const res = await worker.fetch(
      new Request("https://hkfc-api.test/health"),
      misconfiguredEnv,
      CTX,
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "SERVER_MISCONFIGURED" });
  });

  it("does not fall back to a wildcard CORS origin, and no longer advertises apikey/x-client-info", async () => {
    const res = await call("/health");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ENV.ALLOWED_ORIGIN);
    expect(res.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
    expect(res.headers.get("Access-Control-Allow-Headers")).not.toContain("apikey");
    expect(res.headers.get("Access-Control-Allow-Headers")).not.toContain("x-client-info");
  });
});

// ---------------------------------------------------------------------------
// Read-route auth gates.
//
// These GETs shipped unauthenticated: the Worker is on a public URL and CORS
// only constrains browsers, so anyone could curl squad lists, availability,
// recommendations and the whole ability ranking. The default mocks make the
// caller an ordinary authorized player and reject requireCoach, so a route
// that loses its gate turns these assertions red.
// ---------------------------------------------------------------------------

describe("read routes require authentication", () => {
  it("lets an authorized player read a match squad", async () => {
    mocks.getSquadForMatch.mockResolvedValue({ players: [] });
    const res = await call("/api/match/recM1/squad");
    expect(res.status).toBe(200);
    expect(mocks.requireAuthorizedUser).toHaveBeenCalled();
  });

  it("forwards ?side= on a derby squad read (regression: the route used to ignore it)", async () => {
    mocks.getSquadForMatch.mockResolvedValue({ players: [] });
    await call("/api/match/recM1/squad?side=away");
    expect(mocks.getSquadForMatch).toHaveBeenCalledWith(ENV, "recM1", "away");
  });

  it("rejects an unauthenticated match squad read", async () => {
    mocks.requireAuthorizedUser.mockRejectedValue(
      new HttpError("Missing Authorization header", 401, "UNAUTHORIZED"),
    );
    const res = await call("/api/match/recM1/squad");
    expect(res.status).toBe(401);
    expect(mocks.getSquadForMatch).not.toHaveBeenCalled();
  });

  it.each([
    ["/api/match/recM1/players", () => mocks.getPlayersForMatch],
    ["/api/match/recM1/recommendations", () => mocks.getRecommendationsForMatch],
    ["/api/match/recM1/availability", () => mocks.getAvailabilityForMatch],
    ["/api/ranking", () => mocks.getActiveRanking],
    ["/api/ranking/inactive", () => mocks.getInactiveRanking],
    ["/api/recent-changes", () => mocks.getRecentChanges],
    ["/api/playup-watch", () => mocks.getPlayUpWatch],
  ])("denies %s to a non-coach", async (path, handler) => {
    const res = await call(path);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "COACH_ACCESS_REQUIRED" });
    expect(handler()).not.toHaveBeenCalled();
  });

  it("allows a coach through to the ranking", async () => {
    mocks.requireCoach.mockResolvedValue(mocks.authorizedCoach);
    mocks.getActiveRanking.mockResolvedValue({ players: [], activeCount: 0, config: {} });
    const res = await call("/api/ranking");
    expect(res.status).toBe(200);
    expect(mocks.getActiveRanking).toHaveBeenCalled();
  });

  it("allows a coach through to recent-changes and playup-watch", async () => {
    mocks.requireCoach.mockResolvedValue(mocks.authorizedCoach);
    mocks.getRecentChanges.mockResolvedValue({ changes: [] });
    mocks.getPlayUpWatch.mockResolvedValue({ season: "2025-2026", watch: [] });
    const changesRes = await call("/api/recent-changes");
    expect(changesRes.status).toBe(200);
    expect(mocks.getRecentChanges).toHaveBeenCalled();
    const watchRes = await call("/api/playup-watch");
    expect(watchRes.status).toBe(200);
    expect(mocks.getPlayUpWatch).toHaveBeenCalled();
  });
});

describe("kit colour is coach-only", () => {
  it("denies a non-coach", async () => {
    const res = await call("/api/match/recM1/kit", jsonInit({ side: "home", kit: "Blue" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "COACH_ACCESS_REQUIRED" });
    expect(mocks.setMatchKit).not.toHaveBeenCalled();
  });

  it("passes the side and colour through for a coach", async () => {
    mocks.requireCoach.mockResolvedValue(mocks.authorizedCoach);
    mocks.setMatchKit.mockResolvedValue({ success: true, side: "away", kit: "White" });

    const res = await call("/api/match/recM1/kit", jsonInit({ side: "away", kit: "White" }));

    expect(res.status).toBe(200);
    expect(mocks.setMatchKit).toHaveBeenCalledWith(ENV, "recM1", "away", "White", "coach@hkfc.com");
  });

  it("rejects a side that is neither home nor away", async () => {
    mocks.requireCoach.mockResolvedValue(mocks.authorizedCoach);
    const res = await call("/api/match/recM1/kit", jsonInit({ side: "sideways", kit: "Blue" }));
    expect(res.status).toBe(400);
    expect(mocks.setMatchKit).not.toHaveBeenCalled();
  });

  it("treats a missing colour as clearing the choice", async () => {
    mocks.requireCoach.mockResolvedValue(mocks.authorizedCoach);
    mocks.setMatchKit.mockResolvedValue({ success: true, side: "home", kit: "" });
    const res = await call("/api/match/recM1/kit", jsonInit({ side: "home" }));
    expect(res.status).toBe(200);
    expect(mocks.setMatchKit).toHaveBeenCalledWith(ENV, "recM1", "home", "", "coach@hkfc.com");
  });
});

// Season stats back both the player's own dashboard panel and the coach
// drill-in, so they use the same self-or-coach gate as player-fixtures.
describe("player season stats are restricted to self or coach", () => {
  it("lets a player read their own stats", async () => {
    mocks.getPlayerSeasonStats.mockResolvedValue({ gamesPlayed: 3 });
    const res = await call(`/api/player-stats/${mocks.authorizedPlayer.personId}`);
    expect(res.status).toBe(200);
    expect(mocks.getPlayerSeasonStats).toHaveBeenCalledWith(ENV, mocks.authorizedPlayer.personId);
  });

  it("stops a player reading another player's stats", async () => {
    const res = await call("/api/player-stats/recSomeoneElse");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "COACH_ACCESS_REQUIRED" });
    expect(mocks.getPlayerSeasonStats).not.toHaveBeenCalled();
  });

  it("lets a coach drill into any player", async () => {
    mocks.requireAuthorizedUser.mockResolvedValue(mocks.authorizedCoach);
    mocks.getPlayerSeasonStats.mockResolvedValue({ gamesPlayed: 9 });
    const res = await call("/api/player-stats/recSomeoneElse");
    expect(res.status).toBe(200);
    expect(mocks.getPlayerSeasonStats).toHaveBeenCalledWith(ENV, "recSomeoneElse");
  });

  it("rejects an unauthenticated read", async () => {
    mocks.requireAuthorizedUser.mockRejectedValue(
      new HttpError("Missing Authorization header", 401, "UNAUTHORIZED"),
    );
    const res = await call("/api/player-stats/recP1");
    expect(res.status).toBe(401);
    expect(mocks.getPlayerSeasonStats).not.toHaveBeenCalled();
  });
});

