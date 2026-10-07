import { describe, it, expect, vi, beforeEach } from "vitest";

// Integration tests for the Worker router (worker/src/index.ts).
// All domain modules are mocked. Sign-in is REAL: worker/src/auth.ts verifies
// the bearer token against Supabase (/auth/v1/user, faked below), then looks
// the email up in People and reads the Teams coach / section-captain links
// and the Active office rows, all through the in-memory repositories. Who a
// request is therefore comes
// from seeded data, as in production. These tests prove the router derives
// identity from the session (never from query/body params) and applies the
// right gates and error codes.

const mocks = vi.hoisted(() => {
  return {
    getMyProfile: vi.fn(),
    getMyFixtures: vi.fn(),
    getUpcomingFixtures: vi.fn(),
    getPlayersForMatch: vi.fn(),
    getAvailabilityForMatch: vi.fn(),
    syncSquad: vi.fn(),
    applySquadChanges: vi.fn(),
    getPlayerSeasonStats: vi.fn(),
    getTeamAttendance: vi.fn(),
    setMatchKit: vi.fn(),
    toggleAutoSelect: vi.fn(),
    getTeamAutoSelectPlayers: vi.fn(),
    setTeamAutoSelectPlayers: vi.fn(),
    setMyAvailability: vi.fn(),
    setMyAvailabilityForDate: vi.fn(),
    setPlayerAvailability: vi.fn(),
    getRecommendationsForMatch: vi.fn(),
    getTeamAvailabilityForMatch: vi.fn(),
    recommendationOrder: vi.fn(),
    handleGetCalendarLink: vi.fn(),
    handlePlayerCalendarFeed: vi.fn(),
    handleGetTeamCalendarLink: vi.fn(),
    handleTeamCalendarFeed: vi.fn(),
    getActiveRanking: vi.fn(),
    getInactiveRanking: vi.fn(),
    setAbilityGroupConfig: vi.fn(),
    reorderRanking: vi.fn(),
    activatePlayer: vi.fn(),
    deactivatePlayer: vi.fn(),
    getRecentChanges: vi.fn(),
    getChairmanDirectory: vi.fn(),
  };
});

vi.mock("../worker/src/profile", () => ({ getMyProfile: mocks.getMyProfile }));
vi.mock("../worker/src/fixtures", () => ({
  getMyFixtures: mocks.getMyFixtures,
  getUpcomingFixtures: mocks.getUpcomingFixtures,
  SCHEDULED_MATCHES_KEY: "scheduled-matches:v2",
}));
vi.mock("../worker/src/squad", () => ({
  getPlayersForMatch: mocks.getPlayersForMatch,
  getAvailabilityForMatch: mocks.getAvailabilityForMatch,
  syncSquad: mocks.syncSquad,
  applySquadChanges: mocks.applySquadChanges,
  setMatchKit: mocks.setMatchKit,
  toggleAutoSelect: mocks.toggleAutoSelect,
  getTeamAutoSelectPlayers: mocks.getTeamAutoSelectPlayers,
  setTeamAutoSelectPlayers: mocks.setTeamAutoSelectPlayers,
}));
vi.mock("../worker/src/availability", () => ({
  setMyAvailability: mocks.setMyAvailability,
  setMyAvailabilityForDate: mocks.setMyAvailabilityForDate,
  setPlayerAvailability: mocks.setPlayerAvailability,
}));
vi.mock("../worker/src/recommendations", () => ({
  getRecommendationsForMatch: mocks.getRecommendationsForMatch,
  getTeamAvailabilityForMatch: mocks.getTeamAvailabilityForMatch,
  recommendationOrder: mocks.recommendationOrder,
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
  reorderRanking: mocks.reorderRanking,
  activatePlayer: mocks.activatePlayer,
  deactivatePlayer: mocks.deactivatePlayer,
}));
vi.mock("../worker/src/playerStats", () => ({ getPlayerSeasonStats: mocks.getPlayerSeasonStats }));
vi.mock("../worker/src/teamAttendance", () => ({ getTeamAttendance: mocks.getTeamAttendance }));
vi.mock("../worker/src/dashboard", () => ({
  getRecentChanges: mocks.getRecentChanges,
}));
vi.mock("../worker/src/chairman", () => ({
  getChairmanDirectory: mocks.getChairmanDirectory,
  logEmailExport: vi.fn(),
}));

// The routes added after the 6 Oct 2026 review (see "routes added since the
// 6 Oct review" below). Each handler answers {ok: true}; the tests check who
// reaches it, and that it gets the session's user.
const later = vi.hoisted(() => {
  const ok = () => vi.fn(async () => ({ ok: true }));
  return {
    searchPeople: ok(), getPersonAdmin: ok(), getPersonHistory: ok(), getMatchHistory: ok(),
    saveSquad: ok(), saveMembership: ok(), moveStage: ok(),
    listOffices: ok(), listTeams: ok(), addOffice: ok(), editOffice: ok(), createOfficeHolder: ok(), saveTeam: ok(),
    getDataChecks: ok(), linkMatchCard: ok(), resolveRegistrationEvent: ok(),
    getSuspensionsBoard: ok(), createSuspension: ok(), updateSuspension: ok(), clearSuspension: ok(),
    getRegistrationBoard: ok(), registrationCsv: ok(), markRegistered: ok(), unmarkRegistered: ok(), saveRegistrationDetails: ok(),
    getSystemView: ok(), logClientError: ok(),
    listTemplates: ok(), logMessage: ok(),
    reactivationStatus: ok(), askToBeReactivated: ok(), getReactivationRequest: ok(), answerReactivation: ok(),
    noteSquadNotified: ok(), ackDutyChanges: ok(),
  };
});
vi.mock("../worker/src/admin/people", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../worker/src/admin/people")>()),
  searchPeople: later.searchPeople, getPersonAdmin: later.getPersonAdmin, getPersonHistory: later.getPersonHistory,
}));
vi.mock("../worker/src/history", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../worker/src/history")>()),
  getMatchHistory: later.getMatchHistory,
}));
vi.mock("../worker/src/admin/squad", () => ({ saveSquad: later.saveSquad }));
vi.mock("../worker/src/admin/membership", () => ({ saveMembership: later.saveMembership, moveStage: later.moveStage }));
vi.mock("../worker/src/admin/club", () => ({
  listOffices: later.listOffices, listTeams: later.listTeams, addOffice: later.addOffice,
  editOffice: later.editOffice, createOfficeHolder: later.createOfficeHolder, saveTeam: later.saveTeam,
}));
vi.mock("../worker/src/dataChecks", () => ({ getDataChecks: later.getDataChecks }));
vi.mock("../worker/src/matchCardLink", () => ({ linkMatchCard: later.linkMatchCard }));
vi.mock("../worker/src/reRegistrations", () => ({ resolveRegistrationEvent: later.resolveRegistrationEvent }));
vi.mock("../worker/src/discipline", () => ({
  getSuspensionsBoard: later.getSuspensionsBoard, createSuspension: later.createSuspension,
  updateSuspension: later.updateSuspension, clearSuspension: later.clearSuspension,
}));
vi.mock("../worker/src/registration", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../worker/src/registration")>()),
  getRegistrationBoard: later.getRegistrationBoard, registrationCsv: later.registrationCsv, markRegistered: later.markRegistered,
  unmarkRegistered: later.unmarkRegistered, saveRegistrationDetails: later.saveRegistrationDetails,
}));
vi.mock("../worker/src/systemHealth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../worker/src/systemHealth")>()),
  getSystemView: later.getSystemView, logClientError: later.logClientError,
}));
vi.mock("../worker/src/messages", () => ({ listTemplates: later.listTemplates, logMessage: later.logMessage }));
vi.mock("../worker/src/reactivation", () => ({
  reactivationStatus: later.reactivationStatus, askToBeReactivated: later.askToBeReactivated,
  getReactivationRequest: later.getReactivationRequest, answerReactivation: later.answerReactivation,
}));
vi.mock("../worker/src/squadNotices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../worker/src/squadNotices")>()),
  noteSquadNotified: later.noteSquadNotified,
}));
vi.mock("../worker/src/myDuties", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../worker/src/myDuties")>()),
  ackDutyChanges: later.ackDutyChanges,
}));

import worker from "../worker/src/index";
import * as auth from "../worker/src/auth";
import type { AuthorizedUser } from "../worker/src/auth";
import { SupabaseError } from "../worker/src/data/supabase";
import { invalidateAll } from "../worker/src/cache";
import { useFakeRepos } from "./helpers/fakeRepos";
import { fakePostgrest, SUPABASE_TEST_ENV } from "./helpers/postgrest";
import { office, person, recId, team } from "./helpers/factories";

const ENV = {
  ...SUPABASE_TEST_ENV,
  CALENDAR_SECRET: "test-secret",
  ALLOWED_ORIGIN: "https://hkfc-squad-selection.test",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "test-anon-key",
} as any;

const CTX = { waitUntil: () => {} } as any;

// ---------------------------------------------------------------------------
// Who signs in. Each bearer token is one Supabase session; the fake
// /auth/v1/user answers its email, and People/Teams/offices decide the rest.
// ---------------------------------------------------------------------------

const PLAYER = recId("P1");
const COACH = recId("Coach");
const GK_A = recId("GKA");
/** Holds an Active Section Chair row; not a playing member (Active = false), not a coach. */
const CHAIR = recId("Chair");
/** The Assistant Director of Hockey: an office row, no Teams link. */
const ADH = recId("Adh");
/** Linked as Section Captain on a team (Teams link). */
const CAPTAIN = recId("Captain");
/** Holds the Section Captain office, with no Teams link. */
const VICE = recId("Vice");
/** Holds the Hockey Convenor office (the Men's Convenor). */
const CONVENOR = recId("Convenor");
/** Holds the Membership Officer office. */
const MO = recId("Mo");

const TOKENS = {
  player: "player.jwt",
  coach: "coach.jwt",
  gkA: "gk-a.jwt",
  chair: "chair.jwt",
  adh: "adh.jwt",
  captain: "captain.jwt",
  vice: "vice.jwt",
  convenor: "convenor.jwt",
  mo: "mo.jwt",
  /** A verified email with no People record. */
  stranger: "stranger.jwt",
  /** Supabase rejects this one. */
  expired: "expired.jwt",
} as const;

const SESSION_EMAILS: Record<string, string> = {
  [TOKENS.player]: "player@hkfc.com",
  [TOKENS.coach]: "coach@hkfc.com",
  [TOKENS.gkA]: "gk-a@example.com",
  [TOKENS.chair]: "chair@hkfc.com",
  [TOKENS.adh]: "adh@hkfc.com",
  [TOKENS.captain]: "captain@hkfc.com",
  [TOKENS.vice]: "vice@hkfc.com",
  [TOKENS.convenor]: "convenor@hkfc.com",
  [TOKENS.mo]: "mo@hkfc.com",
  [TOKENS.stranger]: "stranger@hkfc.com",
};
/** What requireAuthorizedUser resolves for the ordinary player (the access fields): Active, no coach link, no office. */
/** What requireAuthorizedUser resolves for the ordinary player: Active, no coach link, no office. */
const PLAYER_USER: AuthorizedUser = expect.objectContaining({
  email: "player@hkfc.com", personId: PLAYER, role: "player", coachTeams: [], isSectionCaptain: false, officerRoles: [],
});
/** ...and for the coach: linked as Teams.Coach on Men's 1s. */
const COACH_USER: AuthorizedUser = expect.objectContaining({
  email: "coach@hkfc.com", personId: COACH, role: "coach", coachTeams: ["Men's 1s"], isSectionCaptain: false, officerRoles: [],
});

const db = useFakeRepos(() => ({
  people: [
    person({ id: PLAYER, preferredName: "Test Player", email: "player@hkfc.com", registeredTeam: "Men's 3s" }),
    person({ id: COACH, preferredName: "Test Coach", email: "coach@hkfc.com", registeredTeam: "Men's 1s" }),
    person({ id: GK_A, preferredName: "Keeper A", email: "gk-a@example.com", registeredTeam: "Men's 3s", playingPosition: "Goalkeeper" }),
    person({ id: CHAIR, preferredName: "Test Chair", email: "chair@hkfc.com", active: false }),
    person({ id: ADH, preferredName: "Test ADH", email: "adh@hkfc.com", registeredTeam: "Men's 3s" }),
    person({ id: CAPTAIN, preferredName: "Test Captain", email: "captain@hkfc.com", registeredTeam: "Men's 1s" }),
    person({ id: VICE, preferredName: "Test Vice", email: "vice@hkfc.com", active: false }),
    person({ id: CONVENOR, preferredName: "Test Convenor", email: "convenor@hkfc.com", registeredTeam: "Men's 3s" }),
    person({ id: MO, preferredName: "Test MO", email: "mo@hkfc.com", registeredTeam: "Men's 3s" }),
  ],
  teams: [
    team({ teamName: "Men's 1s", teamRank: 1, coach: [COACH] }),
    team({ teamName: "Men's 3s", teamRank: 3, sectionCaptain: [CAPTAIN] }),
  ],
  officers: [
    office("sectionChair", CHAIR, { designation: "Chairman" }),
    office("assistantDirector", ADH),
    office("sectionCaptain", VICE, { designation: "Men's Vice Captain" }),
    office("hockeyConvenor", CONVENOR),
    office("membershipOfficer", MO),
  ],
}));

/** The session the next call() carries; null sends no Authorization header. */
let session: string | null = TOKENS.player;
const signInAs = (token: string) => { session = token; };
const signOut = () => { session = null; };

function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (session) headers.set("Authorization", `Bearer ${session}`);
  return worker.fetch(new Request(`https://hkfc-api.test${path}`, { ...init, headers }), ENV, CTX);
}

function jsonInit(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** Supabase's /auth/v1/user: the token's email, or 401 for anything it does not know. */
function supabaseAuth(url: string, init: RequestInit): Response {
  if (url !== `${ENV.SUPABASE_URL}/auth/v1/user`) throw new Error(`unexpected fetch: ${url}`);
  const token = String((init.headers as Record<string, string>).Authorization ?? "").replace(/^Bearer /, "");
  const email = SESSION_EMAILS[token];
  return email
    ? new Response(JSON.stringify({ email }), { status: 200 })
    : new Response(JSON.stringify({ msg: "invalid JWT" }), { status: 401 });
}

let requireAuthorizedUserSpy: ReturnType<typeof vi.spyOn>;

// ---------------------------------------------------------------------------
// Availability identity boundary - the browser never controls the identity of
// a "my availability" write. The Worker derives it from the verified session.
// ---------------------------------------------------------------------------

describe("availability identity boundary", () => {
  it("ignores client-supplied email/playerId - identity comes from the session", async () => {
    signInAs(TOKENS.player);
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
    signOut();
    const response = await call("/api/set-my-availability", jsonInit({ matchId: "recM1", status: "Unavailable" }));
    expect(response.status).toBe(401);
    expect(mocks.setMyAvailability).not.toHaveBeenCalled();
  });

  it("bulk date-level endpoint also ignores client-supplied identity", async () => {
    signInAs(TOKENS.gkA);
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
  // Sessions, People lookups and coach/officer links are cached per isolate.
  invalidateAll();
  // Defaults: signed in as the ordinary player, so coach-only routes reject.
  signInAs(TOKENS.player);
  // Only the sign-in check leaves the Worker, plus the error_log row every
  // 5xx writes (systemHealth.ts). No other table is seeded, so any other
  // PostgREST call a route made here would fail the test.
  fakePostgrest({ tables: { error_log: [] }, other: supabaseAuth });
  requireAuthorizedUserSpy = vi.spyOn(auth, "requireAuthorizedUser");

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
  mocks.reorderRanking.mockResolvedValue({ players: [], activeCount: 0, config: {} });
});

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

describe("error codes", () => {
  it("returns 401 UNAUTHORIZED for an expired/invalid session", async () => {
    // Supabase answers 401 for this token.
    signInAs(TOKENS.expired);

    const res = await call("/api/my-profile");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "UNAUTHORIZED" });
  });

  it("returns 403 APPLICATION_ACCESS_DENIED for a denied user", async () => {
    // A real Supabase session whose email matches no People record.
    signInAs(TOKENS.stranger);

    const res = await call("/api/my-fixtures");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "APPLICATION_ACCESS_DENIED" });
  });

  it("returns 403 COACH_ACCESS_REQUIRED when a player hits a coach-only route", async () => {
    const res = await call("/api/ranking/reorder", jsonInit({ playerIds: ["recP9"] }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "COACH_ACCESS_REQUIRED" });
  });

  // A database failure is a 502 naming the
  // table and status, never the database's own message (it can quote a value).
  it("maps a SupabaseError to a 502 without leaking the database message, URL or key", async () => {
    mocks.getMyProfile.mockRejectedValue(
      new SupabaseError(
        "Supabase GET api_people failed (500): Key (email)=(someone.private@example.com) violates something",
        500,
        "XX000",
      ),
    );

    const res = await call("/api/my-profile");
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body).toMatchObject({ error: "DB_ERROR" });
    const serialized = JSON.stringify(body);
    expect(serialized).toContain("api_people");
    expect(serialized).not.toContain("someone.private@example.com");
    expect(serialized).not.toContain("violates");
    expect(serialized).not.toContain(ENV.DATA_SUPABASE_URL);
    expect(serialized).not.toContain(ENV.DATA_SUPABASE_SECRET_KEY);
  });
});

// ---------------------------------------------------------------------------
// IDOR: identity must come from the session, never from query/body params
// ---------------------------------------------------------------------------

describe("session-derived identity (IDOR prevention)", () => {
  it("GET /api/my-profile ignores a ?email= query param", async () => {
    const res = await call("/api/my-profile?email=attacker@evil.com");
    expect(res.status).toBe(200);
    expect(mocks.getMyProfile).toHaveBeenCalledWith(ENV, PLAYER_USER);
  });

  it("GET /api/my-fixtures ignores a ?email= query param", async () => {
    const res = await call("/api/my-fixtures?email=attacker@evil.com");
    expect(res.status).toBe(200);
    expect(mocks.getMyFixtures).toHaveBeenCalledWith(ENV, PLAYER_USER, {
      includePast: false,
    });
  });

  // Results are extra payload, so the player dashboard asks for them only
  // while the past view is open. The identity still comes from the session.
  it("GET /api/my-fixtures passes ?past=1 through as includePast", async () => {
    const res = await call("/api/my-fixtures?past=1&email=attacker@evil.com");
    expect(res.status).toBe(200);
    expect(mocks.getMyFixtures).toHaveBeenCalledWith(ENV, PLAYER_USER, {
      includePast: true,
    });
  });

  it("GET /api/upcoming-fixtures scopes by the session email, ignoring ?email=", async () => {
    const res = await call("/api/upcoming-fixtures?email=attacker@evil.com&team=Men's%201s");
    expect(res.status).toBe(200);
    expect(mocks.getUpcomingFixtures).toHaveBeenCalledWith(ENV, {
      user: PLAYER_USER,
      team: "Men's 1s",
      includePast: false,
      calledOff: true,
    });
  });

  // Played matches are a second Airtable read, so the flag has to reach the
  // query rather than being applied client-side: a played fixture leaves the
  // "Scheduled" status the query reads, so it is absent unless asked for.
  it("GET /api/upcoming-fixtures passes ?past=1 through as includePast", async () => {
    const res = await call("/api/upcoming-fixtures?past=1");
    expect(res.status).toBe(200);
    expect(mocks.getUpcomingFixtures).toHaveBeenCalledWith(ENV, {
      user: PLAYER_USER,
      team: undefined,
      includePast: true,
      calledOff: true,
    });
  });

  it("GET /api/upcoming-fixtures treats any other ?past= value as off", async () => {
    const res = await call("/api/upcoming-fixtures?past=yes");
    expect(res.status).toBe(200);
    expect(mocks.getUpcomingFixtures).toHaveBeenCalledWith(
      ENV,
      expect.objectContaining({ includePast: false }),
    );
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
    expect(mocks.handleGetCalendarLink).toHaveBeenCalledWith(ENV, PLAYER, "https://hkfc-api.test");
  });
});

// ---------------------------------------------------------------------------
// Making players active / inactive: Section Captains only (owner, 2026-10-06).
// A Teams link as Section Captain or the Section Captain office; not coaches,
// the Men's Convenor or the ADH.
// ---------------------------------------------------------------------------

describe("activate / deactivate: Section Captains only", () => {
  const routes = [
    { path: "/api/ranking/activate", fn: () => mocks.activatePlayer },
    { path: "/api/ranking/deactivate", fn: () => mocks.deactivatePlayer },
  ];
  const refused = [
    ["a player", TOKENS.player],
    ["a coach", TOKENS.coach],
    ["the Men's Convenor", TOKENS.convenor],
    ["the Assistant Director of Hockey", TOKENS.adh],
    ["a Section Chair", TOKENS.chair],
  ] as const;
  const allowed = [
    ["a Teams-linked Section Captain", TOKENS.captain, "captain@hkfc.com"],
    ["a Section Captain office holder", TOKENS.vice, "vice@hkfc.com"],
  ] as const;

  for (const { path, fn } of routes) {
    it.each(refused)(`refuses %s on ${path} with SECTION_CAPTAIN_REQUIRED, writing nothing`, async (_who, token) => {
      signInAs(token);
      const res = await call(path, jsonInit({ playerId: "recP9" }));
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: "SECTION_CAPTAIN_REQUIRED" });
      expect(fn()).not.toHaveBeenCalled();
    });

    it.each(allowed)(`lets %s through on ${path}, auditing as the session`, async (_who, token, email) => {
      signInAs(token);
      fn().mockResolvedValue({ players: [], activeCount: 0, config: {} });
      const res = await call(path, jsonInit({ playerId: "recP9", actingEmail: "attacker@evil.com" }));
      expect(res.status).toBe(200);
      expect(fn()).toHaveBeenCalledWith(ENV, "recP9", email);
    });
  }
});

// ---------------------------------------------------------------------------
// Coach-only routes
// ---------------------------------------------------------------------------

describe("coach-only routes", () => {
  const coachOnlyCalls: { path: string; init: RequestInit }[] = [
    { path: "/api/ranking/config", init: jsonInit({ config: { A: 1, B: 1, C: 1, D: 1, E: 1, F: 1, G: 1 } }) },
    { path: "/api/ranking/reorder", init: jsonInit({ playerIds: ["a", "b"] }) },
    { path: "/api/squad/sync", init: jsonInit({ matchId: "recM1", selectedIds: ["a"] }) },
    { path: "/api/squad/changes", init: jsonInit({ matchId: "recM1", add: ["a"], remove: [], version: 0 }) },
    { path: "/api/team/auto-select-players", init: jsonInit({ teamName: "Men's 1s", playerIds: [] }) },
    { path: "/api/match/recM1/auto-select", init: jsonInit({ enabled: true }) },
  ];

  it.each(coachOnlyCalls)("blocks a player from $path with COACH_ACCESS_REQUIRED", async ({ path, init }) => {
    const res = await call(path, init);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "COACH_ACCESS_REQUIRED" });
  });

  it("allows a coach on POST /api/ranking/reorder and uses the session email for audit", async () => {
    signInAs(TOKENS.coach);

    const res = await call(
      "/api/ranking/reorder",
      jsonInit({ playerIds: ["recP9", "recP8"], actingEmail: "attacker@evil.com" }),
    );
    expect(res.status).toBe(200);
    expect(mocks.reorderRanking).toHaveBeenCalledWith(ENV, ["recP9", "recP8"], "coach@hkfc.com", undefined);
  });

  it("passes the optional justification note through on ranking writes", async () => {
    signInAs(TOKENS.coach);
    mocks.reorderRanking.mockResolvedValue({ players: [], activeCount: 0, config: {} });

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
    signInAs(TOKENS.coach);

    const res = await call(
      "/api/squad/sync",
      jsonInit({ matchId: "recM1", selectedIds: ["a", "b"], actingEmail: "attacker@evil.com", side: "home" }),
    );
    expect(res.status).toBe(200);
    expect(mocks.syncSquad).toHaveBeenCalledWith(ENV, "recM1", ["a", "b"], "coach@hkfc.com", "home");
  });

  it("allows a coach on POST /api/squad/changes, acting as the session's person", async () => {
    signInAs(TOKENS.coach);
    mocks.applySquadChanges.mockResolvedValue({ status: "ok", version: 4, selectedIds: ["a"], displaced: [] });
    const body = { matchId: "recM1", side: "home", add: ["a"], remove: ["b"], version: 3, actingEmail: "attacker@evil.com" };

    const res = await call("/api/squad/changes", jsonInit(body));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, version: 4, selectedIds: ["a"], displaced: [] });
    expect(mocks.applySquadChanges).toHaveBeenCalledWith(ENV, body, { email: "coach@hkfc.com", personId: COACH });
  });

  it("answers a squad conflict with 409 SQUAD_CONFLICT naming the players", async () => {
    signInAs(TOKENS.coach);
    mocks.applySquadChanges.mockResolvedValue({
      status: "conflict", version: 6, selectedIds: ["a"], players: [{ id: "b", name: "Kim Lee" }, { id: "c", name: "Sam Ho" }],
    });

    const res = await call("/api/squad/changes", jsonInit({ matchId: "recM1", add: ["b"], remove: ["c"], version: 3 }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "SQUAD_CONFLICT",
      message: "Someone else changed Kim Lee, Sam Ho in this squad. Check and save again.",
      players: [{ id: "b", name: "Kim Lee" }, { id: "c", name: "Sam Ho" }],
      version: 6,
      selectedIds: ["a"],
    });
  });

  it("allows a coach on POST /api/team/auto-select-players and uses the session email", async () => {
    signInAs(TOKENS.coach);

    const res = await call(
      "/api/team/auto-select-players",
      jsonInit({ teamName: "Men's 1s", playerIds: ["a"], actingEmail: "attacker@evil.com" }),
    );
    expect(res.status).toBe(200);
    expect(mocks.setTeamAutoSelectPlayers).toHaveBeenCalledWith(ENV, "Men's 1s", ["a"], "coach@hkfc.com");
  });

  it("allows a coach on POST /api/match/:id/auto-select and uses the session email", async () => {
    signInAs(TOKENS.coach);

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

  // Coach access comes from the Teams.Coach link alone, and covers the
  // linked team only. New with the move to real sign-in.
  it("resolves a Teams.Coach link to coach access for that team only", async () => {
    signInAs(TOKENS.coach);
    const res = await call("/api/my-profile");
    expect(res.status).toBe(200);
    expect(mocks.getMyProfile).toHaveBeenCalledWith(ENV, COACH_USER);
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
    expect(mocks.handleGetTeamCalendarLink).toHaveBeenCalledWith(ENV, PLAYER_USER, "Men's 1s", "https://hkfc-api.test");
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
  it("lets an authorized player read a fixture's team availability, forwarding ?side=", async () => {
    mocks.getTeamAvailabilityForMatch.mockResolvedValue({ selected: [], restOfTeam: [], suggestions: [] });
    const res = await call("/api/match/recM1/team-availability?side=away");
    expect(res.status).toBe(200);
    expect(requireAuthorizedUserSpy).toHaveBeenCalled();
    expect(mocks.getTeamAvailabilityForMatch).toHaveBeenCalledWith(ENV, "recM1", "away");
  });

  it("rejects an unauthenticated team availability read", async () => {
    signOut();
    const res = await call("/api/match/recM1/team-availability");
    expect(res.status).toBe(401);
    expect(mocks.getTeamAvailabilityForMatch).not.toHaveBeenCalled();
  });

  it.each([
    ["/api/match/recM1/players", () => mocks.getPlayersForMatch],
    ["/api/match/recM1/recommendations", () => mocks.getRecommendationsForMatch],
    ["/api/match/recM1/availability", () => mocks.getAvailabilityForMatch],
    ["/api/ranking", () => mocks.getActiveRanking],
    ["/api/ranking/inactive", () => mocks.getInactiveRanking],
    ["/api/recent-changes", () => mocks.getRecentChanges],
    ["/api/team-attendance", () => mocks.getTeamAttendance],
  ])("denies %s to a non-coach", async (path, handler) => {
    const res = await call(path);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "COACH_ACCESS_REQUIRED" });
    expect(handler()).not.toHaveBeenCalled();
  });

  it("allows a coach through to the ranking", async () => {
    signInAs(TOKENS.coach);
    mocks.getActiveRanking.mockResolvedValue({ players: [], activeCount: 0, config: {} });
    const res = await call("/api/ranking");
    expect(res.status).toBe(200);
    expect(mocks.getActiveRanking).toHaveBeenCalled();
  });

  it("gives a coach the squad with its recommendation order in one request, when asked", async () => {
    signInAs(TOKENS.coach);
    const squad = { match: { hkfcTeam: "Men's 3s" }, players: [{ id: "a" }, { id: "b" }] };
    mocks.getPlayersForMatch.mockResolvedValue(squad);
    mocks.recommendationOrder.mockResolvedValue(["b", "a"]);

    const res = await call("/api/match/recM1/players?side=home&recommendations=1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...squad, recommendationOrder: ["b", "a"] });
    // The order is built from the same players: one players-for-match, no second request's worth.
    expect(mocks.getPlayersForMatch).toHaveBeenCalledTimes(1);
    expect(mocks.getPlayersForMatch).toHaveBeenCalledWith(ENV, "recM1", "home");
    expect(mocks.recommendationOrder).toHaveBeenCalledWith(ENV, squad);
    expect(mocks.getRecommendationsForMatch).not.toHaveBeenCalled();

    // Without the flag (an installed app from before), the answer is as it was.
    const plain = await call("/api/match/recM1/players");
    expect(await plain.json()).toEqual(squad);
    expect(mocks.recommendationOrder).toHaveBeenCalledTimes(1);
  });

  it("allows a coach through to the team availability dashboard", async () => {
    signInAs(TOKENS.coach);
    mocks.getTeamAttendance.mockResolvedValue({ season: "", today: "", dates: [], teams: [], fixtures: [] });
    const res = await call("/api/team-attendance");
    expect(res.status).toBe(200);
    expect(mocks.getTeamAttendance).toHaveBeenCalledWith(ENV);
  });

  it("allows a coach through to recent-changes", async () => {
    signInAs(TOKENS.coach);
    mocks.getRecentChanges.mockResolvedValue({ changes: [] });
    const changesRes = await call("/api/recent-changes");
    expect(changesRes.status).toBe(200);
    expect(mocks.getRecentChanges).toHaveBeenCalled();
  });

  // The Play-Up Watch was removed (2026-09-23); its route must not linger.
  it("no longer serves /api/playup-watch", async () => {
    signInAs(TOKENS.coach);
    const res = await call("/api/playup-watch");
    expect(res.status).toBe(404);
  });
});

describe("a coach answering for a player is coach-only", () => {
  it("denies a non-coach, and writes nothing", async () => {
    signInAs(TOKENS.player);
    const res = await call("/api/match/recM1/availability", jsonInit({ playerId: "recP2", status: "Unavailable" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "COACH_ACCESS_REQUIRED" });
    expect(mocks.setPlayerAvailability).not.toHaveBeenCalled();
  });

  it("records the coach from the session, the match from the path, and the player from the body", async () => {
    signInAs(TOKENS.coach);
    mocks.setPlayerAvailability.mockResolvedValue({ success: true, exceptionId: "recX1" });
    const res = await call(
      "/api/match/recM1/availability",
      // A forged coachPersonId in the body must be ignored.
      jsonInit({ playerId: "recP2", status: "Maybe", notes: "Told me at training", coachPersonId: "recForged" }),
    );
    expect(res.status).toBe(200);
    expect(mocks.setPlayerAvailability).toHaveBeenCalledTimes(1);
    expect(mocks.setPlayerAvailability.mock.calls[0][1]).toEqual({
      coachPersonId: COACH,
      playerId: "recP2",
      matchId: "recM1",
      status: "Maybe",
      notes: "Told me at training",
    });
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
    signInAs(TOKENS.coach);
    mocks.setMatchKit.mockResolvedValue({ success: true, side: "away", kit: "White" });

    const res = await call("/api/match/recM1/kit", jsonInit({ side: "away", kit: "White" }));

    expect(res.status).toBe(200);
    expect(mocks.setMatchKit).toHaveBeenCalledWith(ENV, "recM1", "away", "White", "coach@hkfc.com");
  });

  it("rejects a side that is neither home nor away", async () => {
    signInAs(TOKENS.coach);
    const res = await call("/api/match/recM1/kit", jsonInit({ side: "sideways", kit: "Blue" }));
    expect(res.status).toBe(400);
    expect(mocks.setMatchKit).not.toHaveBeenCalled();
  });

  it("treats a missing colour as clearing the choice", async () => {
    signInAs(TOKENS.coach);
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
    const res = await call(`/api/player-stats/${PLAYER}`);
    expect(res.status).toBe(200);
    expect(mocks.getPlayerSeasonStats).toHaveBeenCalledWith(ENV, PLAYER);
  });

  it("stops a player reading another player's stats", async () => {
    const res = await call("/api/player-stats/recSomeoneElse");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "COACH_ACCESS_REQUIRED" });
    expect(mocks.getPlayerSeasonStats).not.toHaveBeenCalled();
  });

  it("lets a coach drill into any player", async () => {
    signInAs(TOKENS.coach);
    mocks.getPlayerSeasonStats.mockResolvedValue({ gamesPlayed: 9 });
    const res = await call("/api/player-stats/recSomeoneElse");
    expect(res.status).toBe(200);
    expect(mocks.getPlayerSeasonStats).toHaveBeenCalledWith(ENV, "recSomeoneElse");
  });

  it("rejects an unauthenticated read", async () => {
    signOut();
    const res = await call(`/api/player-stats/${PLAYER}`);
    expect(res.status).toBe(401);
    expect(mocks.getPlayerSeasonStats).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Office rows (api_offices on Supabase). An Active office lets its holder sign
// in without being a playing member and opens that office's section, and
// nothing more; of the offices, only the Assistant Director of Hockey's
// carries coach access, to every team. New with the move to real sign-in.
// ---------------------------------------------------------------------------

describe("office holders", () => {
  it("lets a Section Chair who is not an Active player sign in, with the office on the session", async () => {
    signInAs(TOKENS.chair);
    const res = await call("/api/my-profile");
    expect(res.status).toBe(200);
    expect(mocks.getMyProfile).toHaveBeenCalledWith(ENV, expect.objectContaining({
      email: "chair@hkfc.com",
      personId: CHAIR,
      role: "player",
      coachTeams: [],
      isSectionCaptain: false,
      officerRoles: [{ office: "sectionChair", designation: "Chairman" }],
    }));
  });

  it("opens the chairman's section to the Section Chair", async () => {
    signInAs(TOKENS.chair);
    mocks.getChairmanDirectory.mockResolvedValue({ people: [] });
    const res = await call("/api/chairman/directory");
    expect(res.status).toBe(200);
    expect(mocks.getChairmanDirectory).toHaveBeenCalledTimes(1);
  });

  it("keeps the chairman's section from an ordinary player, and from a coach", async () => {
    for (const token of [TOKENS.player, TOKENS.coach]) {
      signInAs(token);
      const res = await call("/api/chairman/directory");
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: "OFFICER_ACCESS_REQUIRED" });
    }
    expect(mocks.getChairmanDirectory).not.toHaveBeenCalled();
  });

  it("gives a Section Chair no coach access", async () => {
    signInAs(TOKENS.chair);
    const res = await call("/api/ranking");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "COACH_ACCESS_REQUIRED" });
    expect(mocks.getActiveRanking).not.toHaveBeenCalled();
  });

  it("gives the Assistant Director of Hockey coach access to every team", async () => {
    signInAs(TOKENS.adh);
    mocks.getActiveRanking.mockResolvedValue({ players: [], activeCount: 0, config: {} });
    const res = await call("/api/ranking");
    expect(res.status).toBe(200);
    expect(mocks.getActiveRanking).toHaveBeenCalled();

    await call("/api/my-profile");
    expect(mocks.getMyProfile).toHaveBeenCalledWith(ENV, expect.objectContaining({
      personId: ADH,
      role: "coach",
      coachTeams: ["Men's 1s", "Men's 3s"],
    }));
  });

  it("stops counting a Retired office", async () => {
    // The same person, the row now Retired: Active = false and no office left.
    db.state.officers[0].status = "Retired";
    signInAs(TOKENS.chair);
    const res = await call("/api/my-profile");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "APPLICATION_ACCESS_DENIED" });
    expect(mocks.getMyProfile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// CORS origin allow-list. ALLOWED_ORIGIN may hold several origins so the API
// can serve the old and new frontend hostnames at the same time during a
// domain move. Access-Control-Allow-Origin must always come back as exactly
// one concrete origin - never a wildcard, never the raw comma-separated list.
// ---------------------------------------------------------------------------

describe("CORS origin allow-list", () => {
  const MULTI = {
    ...ENV,
    ALLOWED_ORIGIN: "https://app.example.test, https://old.workers.test",
  } as any;

  const fetchWithOrigin = (origin?: string, env: any = MULTI, path = "/health") =>
    worker.fetch(
      new Request(`https://hkfc-api.test${path}`, {
        headers: origin ? { Origin: origin } : undefined,
      }),
      env,
      CTX,
    );

  const acao = (res: Response) => res.headers.get("Access-Control-Allow-Origin");

  it("echoes back the first allowed origin when the caller uses it", async () => {
    const res = await fetchWithOrigin("https://app.example.test");
    expect(acao(res)).toBe("https://app.example.test");
  });

  it("echoes back a later allowed origin, so the old hostname keeps working", async () => {
    const res = await fetchWithOrigin("https://old.workers.test");
    expect(acao(res)).toBe("https://old.workers.test");
  });

  it("never returns the raw comma-separated list", async () => {
    const res = await fetchWithOrigin("https://app.example.test");
    expect(acao(res)).not.toContain(",");
  });

  it("falls back to the first origin for an origin that is not allowed", async () => {
    const res = await fetchWithOrigin("https://evil.test");
    expect(acao(res)).toBe("https://app.example.test");
    expect(acao(res)).not.toBe("https://evil.test");
    expect(acao(res)).not.toBe("*");
  });

  it("falls back to the first origin when the request carries no Origin header", async () => {
    const res = await fetchWithOrigin(undefined);
    expect(acao(res)).toBe("https://app.example.test");
  });

  it("answers an OPTIONS preflight with the caller's allowed origin and Vary: Origin", async () => {
    const res = await worker.fetch(
      new Request("https://hkfc-api.test/api/my-fixtures", {
        method: "OPTIONS",
        headers: { Origin: "https://old.workers.test" },
      }),
      MULTI,
      CTX,
    );
    expect(res.status).toBe(204);
    expect(acao(res)).toBe("https://old.workers.test");
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("still fails closed when every entry is blank", async () => {
    const res = await fetchWithOrigin("https://app.example.test", {
      ...ENV,
      ALLOWED_ORIGIN: " , ",
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "SERVER_MISCONFIGURED" });
  });

  it("keeps single-origin configuration working unchanged", async () => {
    const res = await fetchWithOrigin("https://hkfc-squad-selection.test", ENV);
    expect(acao(res)).toBe("https://hkfc-squad-selection.test");
  });
});

// ---------------------------------------------------------------------------
// Deep health check. Plain /health only proves the Worker is running. A
// rejected Airtable token once looked exactly like a frontend fault: sign-in
// worked, /health was green, and every screen behind the login failed. The
// deep check now asks the Supabase data project, and never Airtable.
// ---------------------------------------------------------------------------

describe("GET /health?deep=1", () => {
  const DATA_ENV = { ...ENV, DATA_SUPABASE_URL: "https://data.supabase.test", DATA_SUPABASE_SECRET_KEY: "sb_secret_test" };
  const withSupabase = async (responder: () => Response) => {
    invalidateAll();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).startsWith("https://data.supabase.test/rest/v1/api_teams")) return responder();
      throw new Error("unexpected fetch: " + String(input));
    }) as typeof fetch;
    try {
      return await worker.fetch(new Request("https://hkfc-api.test/health?deep=1"), DATA_ENV, CTX);
    } finally {
      globalThis.fetch = realFetch;
      invalidateAll();
    }
  };

  it("reports supabase ok when the data project answers, and asks nothing of Airtable", async () => {
    const res = await withSupabase(() => new Response("[]", { status: 200 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: "ok", supabase: "ok" });
    expect(body).not.toHaveProperty("airtable");
  });

  it("reports supabase error when the key is rejected, without leaking why", async () => {
    const res = await withSupabase(() => new Response('{"message":"Invalid API key"}', { status: 401 }));
    // Still 200: the Worker itself is up. Only the dependency is broken.
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: "ok", supabase: "error" });
    // No message, no record, no configuration - detail belongs in the logs.
    expect(JSON.stringify(body)).not.toMatch(/Invalid API key|sb_secret|supabase\.test/i);
  });

  it("leaves plain /health untouched, and free of any Airtable call", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      throw new Error("plain /health must not call out: " + String(input));
    }) as typeof fetch;
    try {
      const res = await call("/health");
      expect(res.status).toBe(200);
      expect(await res.json()).not.toHaveProperty("airtable");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// Routes added since the 6 Oct 2026 review (security review, 7 Oct). Each
// officers' route is pinned to the README's "Screens and who opens them":
// every seeded signed-in person is tried, and only the offices the README
// names get through, with their own session as the user. Sections come from
// office rows only, so a Teams-linked Section Captain without the office
// opens none of them.
// ---------------------------------------------------------------------------

describe("routes added since the 6 Oct review", () => {
  const WHO = {
    player: TOKENS.player,
    coach: TOKENS.coach,
    chair: TOKENS.chair,
    adh: TOKENS.adh,
    teamsLinkedCaptain: TOKENS.captain,
    sectionCaptain: TOKENS.vice,
    convenor: TOKENS.convenor,
    membershipOfficer: TOKENS.mo,
  } as const;
  type Who = keyof typeof WHO;
  const PERSON: Record<Who, string> = {
    player: PLAYER, coach: COACH, chair: CHAIR, adh: ADH, teamsLinkedCaptain: CAPTAIN, sectionCaptain: VICE, convenor: CONVENOR, membershipOfficer: MO,
  };

  // README "Screens and who opens them".
  const PEOPLE: Who[] = ["membershipOfficer", "convenor", "sectionCaptain"];
  const MEMBERSHIP: Who[] = ["membershipOfficer", "sectionCaptain"];
  const CLUB: Who[] = ["sectionCaptain"];
  const DATA_CHECKS: Who[] = ["convenor", "sectionCaptain"];
  const SUSPENSIONS: Who[] = ["convenor"];
  const REGISTRATION: Who[] = ["convenor"];

  const ID = "11111111-2222-3333-4444-555555555555";
  const officerRoutes: { method: "GET" | "POST"; path: string; who: Who[]; handler: () => ReturnType<typeof vi.fn> }[] = [
    { method: "GET", path: "/api/admin/people?q=Smith", who: PEOPLE, handler: () => later.searchPeople },
    { method: "GET", path: `/api/admin/people/${PLAYER}`, who: PEOPLE, handler: () => later.getPersonAdmin },
    // The route opens to the people section; squad.ts then checks each field (adminSquad.test.ts).
    { method: "POST", path: `/api/admin/people/${PLAYER}/squad`, who: PEOPLE, handler: () => later.saveSquad },
    { method: "POST", path: `/api/admin/people/${PLAYER}/membership`, who: MEMBERSHIP, handler: () => later.saveMembership },
    { method: "POST", path: `/api/admin/people/${PLAYER}/stage`, who: MEMBERSHIP, handler: () => later.moveStage },
    { method: "GET", path: "/api/admin/offices", who: CLUB, handler: () => later.listOffices },
    { method: "GET", path: "/api/admin/teams", who: CLUB, handler: () => later.listTeams },
    { method: "POST", path: "/api/admin/offices", who: CLUB, handler: () => later.addOffice },
    { method: "POST", path: `/api/admin/offices/${ID}`, who: CLUB, handler: () => later.editOffice },
    { method: "POST", path: "/api/admin/people", who: CLUB, handler: () => later.createOfficeHolder },
    { method: "POST", path: `/api/admin/teams/${ID}`, who: CLUB, handler: () => later.saveTeam },
    { method: "GET", path: "/api/admin/data-checks", who: DATA_CHECKS, handler: () => later.getDataChecks },
    { method: "POST", path: `/api/admin/match-cards/${ID}/link`, who: DATA_CHECKS, handler: () => later.linkMatchCard },
    { method: "POST", path: `/api/admin/registration-events/${ID}/resolve`, who: DATA_CHECKS, handler: () => later.resolveRegistrationEvent },
    { method: "GET", path: "/api/discipline/suspensions", who: SUSPENSIONS, handler: () => later.getSuspensionsBoard },
    { method: "POST", path: "/api/discipline/suspensions", who: SUSPENSIONS, handler: () => later.createSuspension },
    { method: "POST", path: `/api/discipline/suspensions/${ID}`, who: SUSPENSIONS, handler: () => later.updateSuspension },
    { method: "POST", path: `/api/discipline/suspensions/${ID}/clear`, who: SUSPENSIONS, handler: () => later.clearSuspension },
    { method: "GET", path: "/api/registration/board", who: REGISTRATION, handler: () => later.getRegistrationBoard },
    { method: "GET", path: "/api/registration/export?todo=1", who: REGISTRATION, handler: () => later.registrationCsv },
    { method: "POST", path: "/api/registration/registered", who: REGISTRATION, handler: () => later.markRegistered },
    { method: "POST", path: "/api/registration/unregistered", who: REGISTRATION, handler: () => later.unmarkRegistered },
    { method: "POST", path: "/api/registration/details", who: REGISTRATION, handler: () => later.saveRegistrationDetails },
  ];
  const request = (method: "GET" | "POST", path: string) => call(path, method === "POST" ? jsonInit({ personId: "recForged", actor: "recForged" }) : {});

  for (const { method, path, who, handler } of officerRoutes) {
    const cases = (Object.keys(WHO) as Who[]).map((w) => [w, who.includes(w)] as const);

    it.each(cases)(`${method} ${path}: %s allowed=%s`, async (w, allowed) => {
      signInAs(WHO[w]);
      const res = await request(method, path);
      if (allowed) {
        expect(res.status).toBe(200);
        expect(handler()).toHaveBeenCalledTimes(1);
        // The acting officer is the session's person, whatever the body says.
        const user = handler().mock.calls[0].find((a: unknown) => !!a && typeof a === "object" && "personId" in (a as object));
        if (user) expect((user as AuthorizedUser).personId).toBe(PERSON[w]);
      } else {
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ error: "OFFICER_ACCESS_REQUIRED" });
        expect(handler()).not.toHaveBeenCalled();
      }
    });

    it(`${method} ${path}: 401 without a session`, async () => {
      signOut();
      const res = await request(method, path);
      expect(res.status).toBe(401);
      expect(handler()).not.toHaveBeenCalled();
    });
  }

  // Signed in, then the module decides (history.ts, systemHealth.ts,
  // messages.ts, myDuties.ts): the route must hand over the session's user.
  const signedInRoutes: { method: "GET" | "POST"; path: string; handler: () => ReturnType<typeof vi.fn> }[] = [
    { method: "GET", path: `/api/history?person=${PLAYER}`, handler: () => later.getPersonHistory },
    { method: "GET", path: "/api/history?match=recM1", handler: () => later.getMatchHistory },
    { method: "GET", path: "/api/system", handler: () => later.getSystemView },
    { method: "GET", path: "/api/messages/templates", handler: () => later.listTemplates },
    { method: "POST", path: "/api/messages/log", handler: () => later.logMessage },
    { method: "POST", path: "/api/umpiring/seen", handler: () => later.ackDutyChanges },
    { method: "GET", path: `/api/reactivation/${ID}`, handler: () => later.getReactivationRequest },
    { method: "POST", path: `/api/reactivation/${ID}`, handler: () => later.answerReactivation },
  ];

  it.each(signedInRoutes)("$method $path hands the session's user to the module", async ({ method, path, handler }) => {
    signInAs(TOKENS.coach);
    const res = await request(method, path);
    expect(res.status).toBe(200);
    const args = handler().mock.calls[0];
    expect(args[0]).toBe(ENV);
    // getPersonHistory takes the user last; the others second.
    expect(args.filter((a: unknown) => !!a && typeof a === "object" && (a as AuthorizedUser).personId === COACH)).toHaveLength(1);
  });

  it.each(signedInRoutes)("$method $path is 401 without a session, and 403 for an email with no People record", async ({ method, path, handler }) => {
    signOut();
    expect((await request(method, path)).status).toBe(401);
    signInAs(TOKENS.stranger);
    expect((await request(method, path)).status).toBe(403);
    expect(handler()).not.toHaveBeenCalled();
  });

  it("history: the reader is given the session's user, not anyone the query names", async () => {
    signInAs(TOKENS.player);
    await call(`/api/history?person=${COACH}&viewer=${VICE}`);
    expect(later.getPersonHistory).toHaveBeenCalledWith(ENV, COACH, expect.objectContaining({ personId: PLAYER, officerRoles: [] }));
  });

  it("POST /api/squad/notified is coach-only and records the session's person", async () => {
    const res = await call("/api/squad/notified", jsonInit({ matchId: "recM1", side: "home", actorId: "recForged" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "COACH_ACCESS_REQUIRED" });
    expect(later.noteSquadNotified).not.toHaveBeenCalled();

    signInAs(TOKENS.coach);
    expect((await call("/api/squad/notified", jsonInit({ matchId: "recM1", side: "home", actorId: "recForged" }))).status).toBe(200);
    expect(later.noteSquadNotified).toHaveBeenCalledWith(ENV, COACH, expect.objectContaining({ matchId: "recM1" }));
  });

  it("POST /api/client-error needs a session and logs against the session's person", async () => {
    const report = { kind: "render", message: "boom", route: "/coach", stack: "" };
    signOut();
    expect((await call("/api/client-error", jsonInit(report))).status).toBe(401);
    expect(later.logClientError).not.toHaveBeenCalled();

    signInAs(TOKENS.player);
    expect((await call("/api/client-error", jsonInit({ ...report, personId: "recForged" }))).status).toBe(200);
    expect(later.logClientError).toHaveBeenCalledWith(ENV, expect.objectContaining({ personId: PLAYER }), expect.objectContaining({ message: "boom" }));
  });

  // Asking to be reactivated: the asker has no access yet, so only a verified
  // email is needed; it is the session's email, never one the body names.
  it("/api/reactivation takes the session's verified email, even without a People record", async () => {
    signOut();
    expect((await call("/api/reactivation")).status).toBe(401);
    expect(later.reactivationStatus).not.toHaveBeenCalled();

    signInAs(TOKENS.stranger);
    expect((await call("/api/reactivation")).status).toBe(200);
    expect(later.reactivationStatus).toHaveBeenCalledWith(ENV, "stranger@hkfc.com");
    expect((await call("/api/reactivation", jsonInit({ email: "someone@else.com" }))).status).toBe(200);
    expect(later.askToBeReactivated).toHaveBeenCalledWith(ENV, "stranger@hkfc.com");
  });
});
