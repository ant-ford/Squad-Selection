/**
 * Every route the Worker answers, in the order dispatch() tries them
 * (router.ts). The first entry whose method and path match wins, so a
 * specific path goes before a pattern that would also match it.
 *
 * To add a route, add one line in the section it belongs to:
 *
 *   route("GET", "/api/thing/:id([0-9a-f-]{36})", "signed-in", ({ env, user, params }) => getThing(env, user, params.id)),
 *
 * and add it to the expected list in tests/routeTable.test.ts. The guard is
 * checked before the handler runs (router.ts lists them); the handler gets
 * env, request, url, origin, params, and the guard's user or verified email.
 * Return the data for a 200 JSON answer, or a Response.
 */
import { getCached } from "./cache";
import { handleFileRequest, serveClubDoc } from "./files";
import { db } from "./data/supabase";
import { HttpError, json, requireParam } from "./http";
import { route, scope, readBodyOrEmpty, readJsonBody, type Route, type Scope } from "./router";
import { listTemplates, logMessage } from "./messages";
import { noteSquadNotified } from "./squadNotices";
import { pushConfig, pushSquad, pushSubscribe, pushUnsubscribe } from "./push";
import { answerReactivation, askToBeReactivated, getReactivationRequest, reactivationStatus } from "./reactivation";
import { coachesEveryTeam, coachesPlayer, requireCoachOfTeam } from "./auth";
import { requireCoachOfMatchSide } from "./coachAccess";
import { approveApplicant, getActiveMembersCsv, getMembershipBoard, getMembershipInsights, getNumberHolders } from "./membership";
import { getFormsDue } from "./formsDue";
import { getStatementBoard, requestReviewEmail } from "./statements";
import { getReview, submitMemberReport, submitOfficerReview, submitSponsorReview } from "./reviews";
import { getMyDeclarations, submitDeclarations } from "./declarations";
import { getMySeasonPlan, getSeasonPlanBoard, submitSeasonPlan } from "./seasonPlan";
import { getMyVolunteering, getVolunteersBoard, saveVolunteering } from "./volunteering";
import { ackDutyChanges } from "./myDuties";
import { assignDuty, confirmAssignment, getUmpiringBoard, getUmpiringReport, setNoShow, setNotNeeded, takeDuty, withdrawAssignment } from "./umpiring";
import { confirmDetails, deleteMyProfile, getMyDetails, saveKitSizes, saveSection, uploadFile } from "./details";
import { readIdDocument } from "./idRead";
import { draftSponsorAnswers, getSigningView, remakeApplicationPdf, sendApplicationOn, signApplication } from "./applicationSigning";
import { getQuiz, listQuizzes, quizScoreBoard, submitQuiz } from "./quizzes";
import {
  addSession,
  declineRegistration,
  getMyTrial,
  invitePracticeTrial,
  listSessions,
  registerInterest,
  removeSession,
  saveMyTrial,
  submitRegistration,
} from "./trials";
import {
  confirmPayment,
  countAudience,
  deleteEvent,
  findPeople,
  getCharges,
  markChargesSent,
  checkIn,
  checkinLink,
  getCheckIn,
  setAttendance,
  setRegisterTaken,
  tickEveryone,
  uploadPaymentProof,
  waiveCharge,
  getEventResponses,
  getManageView,
  getMyEvents,
  respondToEvent,
  saveEvent,
  searchEventPeople,
  setEventStatus,
  setSocialSecretaries,
  uploadPoster,
} from "./events";
import { getApply, polishAnswer, saveClubs, saveFamily, saveTrials, submitApplication, uploadApplicantFile } from "./apply";
import {
  completeJoinerTask,
  createJoiner,
  getJoiner,
  getJoinerOptions,
  getJoinerTask,
  inviteJoiner,
  requestKit,
  requestRegistration,
  updateJoiner,
} from "./joiners";
import {
  allocateSpare,
  confirmKit,
  editSizes,
  getKitBoard,
  getMyKit,
  getSetHistory,
  getUncollectedKit,
  giveNewNumber,
  moveKit,
  releaseSet,
  setOrderExpected,
  setOrderReceived,
  swapItem,
  topUpCsv,
} from "./kit";
import { getRegistrationBoard, markRegistered, registrationCsv, saveRegistrationDetails, unmarkRegistered } from "./registration";
import { resolveRegistrationEvent } from "./reRegistrations";
import { clearSuspension, clearSuspensionFlag, createSuspension, getSuspensionsBoard, updateSuspension } from "./discipline";
import { ADMIN_ROUTES } from "./admin/routes";
import { getDataChecks } from "./dataChecks";
import { linkMatchCard } from "./matchCardLink";
import { getMyTasks } from "./myTasks";
import { getSeasonStats } from "./clubStats";
import { getChairmanDirectory, logEmailExport, type EmailExportInput } from "./chairman";
import { getMyProfile } from "./profile";
import { getMyFixtures, getUpcomingFixtures } from "./fixtures";
import {
  getPlayersForMatch,
  getAvailabilityForMatch,
  syncSquad,
  applySquadChanges,
  setMatchKit,
  toggleAutoSelect,
  getTeamAutoSelectPlayers,
  setTeamAutoSelectPlayers,
} from "./squad";
import type { SquadChangesBody } from "./squad";
import { setMyAvailability, setMyAvailabilityForDate, setPlayerAvailability, setPlayerOptInOnly } from "./availability";
import { createAvailabilityRule, deleteAvailabilityRule, getRulesForPlayer } from "./availabilityRules";
import { getRecommendationsForMatch, getTeamAvailabilityForMatch, recommendationOrder } from "./recommendations";
import {
  handleGetCalendarLink,
  handlePlayerCalendarFeed,
  handleGetTeamCalendarLink,
  handleTeamCalendarFeed,
} from "./calendar";
import {
  getActiveRanking,
  getInactiveRanking,
  setAbilityGroupConfig,
  reorderRanking,
  activatePlayer,
  deactivatePlayer,
} from "./ranking";
import type { AbilityGroupConfigMap, Player } from "../../shared/schema/domainTypes";
import { getRecentChanges } from "./dashboard";
import { getPlayerSeasonStats } from "./playerStats";
import { getPlayerAttendance } from "./playerAttendance";
import { getTeamAttendance } from "./teamAttendance";
import { writesOff } from "./readOnly";
import { getSystemView, logClientError, readClientError } from "./systemHealth";

/** Path parameter shapes the routes share. */
const UUID = "[0-9a-f-]{36}";
const JOINER_ID = "[A-Za-z0-9-]{3,40}";

export const ROUTES: readonly Route[] = [
  // ── Health Check (Public) ──────────────────────────────────────────────
  route("GET", "/health", "public", async ({ env, url }) => {
    // writes: "off" while the read-only switch is on; absent otherwise.
    const writes = writesOff(env) ? { writes: "off" } : {};
    // ?deep=1 additionally reports whether the Worker's own credentials
    // still work: the Supabase data project, once one is configured. Plain
    // /health only proves the Worker is running, which is exactly why a
    // rejected Airtable token once looked like a frontend fault: sign-in
    // succeeded, /health was green, and every screen behind the login
    // failed.
    //
    // Reports "ok" or "error" and nothing else - no message, no record, no
    // configuration. The detail stays in Workers Logs. Cached for 60s so it
    // cannot be used to hammer the database.
    if (url.searchParams.get("deep") === "1") {
      const supabase = env.DATA_SUPABASE_URL
        ? (
            await getCached<"ok" | "error">(
              "health:supabase",
              async () => {
                try {
                  await db(env).select("api_teams", "select=id&limit=1");
                  return "ok";
                } catch (err) {
                  console.error("Health check: Supabase unreachable:", err instanceof Error ? err.message : err);
                  return "error";
                }
              },
              60 * 1000,
            )
          ).data
        : undefined;
      return { status: "ok", ...(supabase ? { supabase } : {}), ...writes, timestamp: new Date().toISOString() };
    }
    return { status: "ok", ...writes, timestamp: new Date().toISOString() };
  }),

  // ── Stored files (signed link, no session - see files.ts) ─────────────
  route("GET", `/api/files/:id(${UUID})`, "signed-file", ({ env, params, url }) => handleFileRequest(env, params.id, url)),

  // ── Match / Squad (Read - Authenticated) ───────────────────────────────
  // Player-facing: the fixture sheet's selected / rest-of-team /
  // suggestions lists. Names, positions and statuses only - see
  // getTeamAvailabilityForMatch for what is left out and why.
  route("GET", "/api/match/:id/team-availability", "signed-in", ({ env, url, params }) => {
    const side = url.searchParams.get("side") as "home" | "away" | null;
    return getTeamAvailabilityForMatch(env, params.id, side ?? undefined);
  }),

  // The remaining match reads back the coach-only selection screens: the
  // coaches of the fixture's HKFC side(s) only (coachAccess.ts).
  route("GET", "/api/match/:id/players", "coach-of-match", async ({ env, url, params }) => {
    const side = url.searchParams.get("side") as "home" | "away" | null;
    const data = await getPlayersForMatch(env, params.id, side ?? undefined);
    // ?recommendations=1: the squad screen's ranking with the players, in
    // the same request (it used to ask /recommendations, which built the
    // whole players-for-match again).
    if (url.searchParams.get("recommendations") === "1") {
      return { ...data, recommendationOrder: await recommendationOrder(env, data) };
    }
    return data;
  }),
  route("GET", "/api/match/:id/recommendations", "coach-of-match", ({ env, url, params }) => {
    const side = url.searchParams.get("side") as "home" | "away" | null;
    const position = url.searchParams.get("position") ?? undefined;
    const limitParam = url.searchParams.get("limit");
    return getRecommendationsForMatch(
      env,
      params.id,
      side ?? undefined,
      position,
      limitParam ? Number(limitParam) : undefined,
      url.searchParams.get("includeSelected") === "1",
    );
  }),
  route("GET", "/api/match/:id/availability", "coach-of-match", ({ env, params }) => getAvailabilityForMatch(env, params.id)),
  // A coach answering for a player who cannot get into the app. The only
  // write that names another person, so it is coach-gated and the coach's
  // identity - from the session, never the body - goes on the record.
  // The fixture must be one of the coach's; the player can be anyone in
  // its pool (the squad screen lists every player who could play up or
  // down), so the player is not narrowed further.
  route("POST", "/api/match/:id/availability", "coach-of-match", async ({ request, env, user, params }) => {
    const body = (await readJsonBody(request)) as { playerId?: string; status?: string; notes?: string };
    return setPlayerAvailability(env, {
      coachPersonId: user.personId,
      playerId: String(body.playerId || ""),
      matchId: params.id,
      status: (body.status || "") as "Available" | "Maybe" | "Unavailable",
      notes: typeof body.notes === "string" ? body.notes : undefined,
    });
  }),

  // ── Opt-In Only (Write - Coach) ────────────────────────────────────────
  // Inverts the club's opt-out default for one player, so every fixture
  // they have not answered counts as Unavailable. Coach-only on purpose:
  // it exists for players who are not maintaining their own status, so it
  // must not be something they can switch off.
  route(
    "POST",
    "/api/player/:id/opt-in-only",
    "coach",
    async ({ request, env, user, params }) => {
      const body = (await readJsonBody(request)) as { optInOnly?: unknown };
      if (typeof body.optInOnly !== "boolean") {
        throw new HttpError("optInOnly must be a boolean", 400);
      }
      return setPlayerOptInOnly(env, {
        coachEmail: user.email,
        // Season-long and about the player, not one fixture: only a coach
        // of the player's own team, or of every team (availability.ts).
        mayChange: coachesEveryTeam(user) ? undefined : (player) => coachesPlayer(user, player),
        playerId: params.id,
        optInOnly: body.optInOnly,
      });
    },
    "coach-of-player",
  ),

  // ── Auto-Select Toggle (Write - Coach) ─────────────────────────────────
  route("POST", "/api/match/:id/auto-select", "coach-of-match", async ({ request, env, user, params }) => {
    const body = await readJsonBody(request);
    const enabled =
      typeof body.enabled === "boolean"
        ? body.enabled
        : body.enabled === "true"
        ? true
        : body.enabled === "false"
        ? false
        : undefined;

    if (typeof enabled !== "boolean") {
      throw new HttpError("enabled must be a boolean", 400);
    }

    return toggleAutoSelect(env, params.id, enabled, user.email);
  }),

  // ── Standing Availability Rules (Self-service) ─────────────────────────
  // Identity always comes from the session: a player can only read, add
  // or remove their OWN rules.
  route("GET", "/api/my-availability-rules", "signed-in", async ({ env, user }) => ({ rules: await getRulesForPlayer(env, user.personId) })),
  route("POST", "/api/my-availability-rules", "signed-in", async ({ request, env, user }) => {
    const body = await readJsonBody(request);
    return createAvailabilityRule(env, user.personId, {
      ruleType: String(body.ruleType ?? ""),
      availability: String(body.availability ?? ""),
      startDate: body.startDate ? String(body.startDate) : undefined,
      endDate: body.endDate ? String(body.endDate) : undefined,
      notes: body.notes ? String(body.notes) : undefined,
    });
  }),
  route("POST", "/api/my-availability-rules/:id", "signed-in", ({ env, user, params }) => deleteAvailabilityRule(env, user.personId, params.id)),

  // ── Kit Colour (Write - Coach) ─────────────────────────────────────────
  route(
    "POST",
    "/api/match/:id/kit",
    "coach",
    async ({ request, env, user, params }) => {
      const body = await readJsonBody(request);
      const side = body.side === "away" ? "away" : body.side === "home" ? "home" : undefined;
      if (!side) throw new HttpError('side must be "home" or "away"', 400);
      await requireCoachOfMatchSide(env, user, params.id, side);
      const kit = typeof body.kit === "string" ? body.kit : "";
      return setMatchKit(env, params.id, side, kit, user.email);
    },
    "coach-of-match-side",
  ),

  // ── Priority Player List (Read/Write - Coach) ──────────────────────────
  route(
    "GET",
    "/api/team/auto-select-players",
    "coach",
    ({ env, user, url }) => {
      const teamName = requireParam(url.searchParams.get("team"), "team");
      requireCoachOfTeam(user, teamName);
      return getTeamAutoSelectPlayers(env, teamName);
    },
    "coach-of-team",
  ),
  route(
    "POST",
    "/api/team/auto-select-players",
    "coach",
    async ({ request, env, user }) => {
      const body = await readJsonBody(request);
      const teamName = requireParam(body.teamName, "teamName");
      requireCoachOfTeam(user, teamName);
      return setTeamAutoSelectPlayers(env, teamName, body.playerIds || [], user.email);
    },
    "coach-of-team",
  ),

  // ── Player Season Stats (Read - Self or Coach) ─────────────────────────
  // Backs the player's own stats panel and the coach drill-in from the
  // ranking / selection screens, so the same gate as player-fixtures.
  route("GET", "/api/player-stats/:id", "self-or-coach", ({ env, params }) => getPlayerSeasonStats(env, params.id)),

  // ── Player Attendance Grid (Read - Self or Coach) ──────────────────────
  // Past attendance and future availability per fixture; same gate as stats.
  route("GET", "/api/player-attendance/:id", "self-or-coach", ({ env, params }) => getPlayerAttendance(env, params.id)),

  // ── Team Availability Dashboard (Read - Coach) ─────────────────────────
  // The coach's own squads' grids at once (every squad for those who coach
  // every team): names and statuses only, no notes.
  route("GET", "/api/team-attendance", "coach", ({ env, user }) => getTeamAttendance(env, user.coachTeams)),

  // Player-facing routes: identity always comes from the verified Supabase
  // session, never from client-supplied email query parameters.
  route("GET", "/api/my-profile", "signed-in", ({ env, user }) => getMyProfile(env, user)),
  // Club, team and player statistics, one season per request (clubStats.ts).
  route("GET", "/api/stats/season", "signed-in", ({ env, user, url }) => getSeasonStats(env, user, url.searchParams.get("season") ?? "")),
  route("GET", "/api/my-tasks", "signed-in", ({ env, user }) => getMyTasks(env, user)),
  // ── System health (systemHealth.ts) ───────────────────────────────────
  // A crash the app hit: signed-in only, small, rate-limited per person.
  route("POST", "/api/client-error", "signed-in", async ({ request, env, user }) => logClientError(env, user, await readClientError(request))),
  // The owner and the Section Captains (checked in getSystemView).
  route("GET", "/api/system", "signed-in", ({ env, user }) => getSystemView(env, user)),
  route("GET", "/api/my-fixtures", "signed-in", ({ env, user, url }) => {
    // Results are a meaningful amount of payload for a screen most players
    // open to answer an upcoming fixture, so they come only on request.
    const includePast = url.searchParams.get("past") === "1";
    return getMyFixtures(env, user, { includePast });
  }),
  route("GET", "/api/upcoming-fixtures", "signed-in", ({ env, user, url }) => {
    const team = url.searchParams.get("team") ?? undefined;
    // Recently played matches cost an extra Airtable read, so the coach
    // list asks for them only while "Show past" is on.
    const includePast = url.searchParams.get("past") === "1";
    return getUpcomingFixtures(env, { user, team, includePast, calledOff: true });
  }),

  // Dashboard metrics (Coach) - expose every player's rank moves / play-up counts.
  route("GET", "/api/recent-changes", "coach", ({ env, url }) => {
    const days = Number(url.searchParams.get("days") ?? 7);
    return getRecentChanges(env, Number.isFinite(days) && days > 0 ? days : 7);
  }),

  // Player self-service availability: identity comes from the session, so a
  // caller cannot update another person's availability via body.email.
  // Date-level bulk availability (special goalkeeper view UX shortcut):
  // performs the existing match-level updates for every HKFC fixture on
  // the date. Identity comes from the verified Supabase session.
  route("POST", "/api/set-my-availability-for-date", "signed-in", async ({ request, env, user }) => {
    const body = (await readJsonBody(request)) as { date?: string; status?: string; notes?: string };
    return setMyAvailabilityForDate(env, {
      email: user.email,
      date: body.date || "",
      status: (body.status || "") as "Available" | "Maybe" | "Unavailable",
      notes: body.notes,
    });
  }),

  route("POST", "/api/set-my-availability", "signed-in", async ({ request, env, user }) => {
    const body = (await readJsonBody(request)) as {
      matchId?: string;
      status?: string;
      notes?: string;
      email?: string;
      playerId?: string;
    };
    // SECURITY: the player identity comes ONLY from the verified Supabase
    // session. Client-supplied email/playerId fields are deliberately
    // dropped - the browser never tells the Worker who is making a
    // "my availability" request.
    return setMyAvailability(env, {
      email: user.email,
      matchId: body.matchId || "",
      status: (body.status || "") as "Available" | "Maybe" | "Unavailable",
      notes: body.notes,
    });
  }),

  route(
    "POST",
    "/api/squad/sync",
    "coach",
    async ({ request, env, user, origin }) => {
      const body = (await readJsonBody(request)) as {
        matchId: string;
        selectedIds: string[];
        side?: "home" | "away";
      };
      const side = body.side === "home" || body.side === "away" ? body.side : undefined;
      await requireCoachOfMatchSide(env, user, String(body.matchId ?? ""), side);
      const { displaced } = await syncSquad(env, body.matchId, body.selectedIds, user.email, body.side);
      return json({ success: true, displaced }, 200, origin);
    },
    "coach-of-match-side",
  ),

  // Notify was used: the squad as it stands is what the players were told (squadNotices.ts).
  // The side must be one of the coach's teams.
  route(
    "POST",
    "/api/squad/notified",
    "coach",
    async ({ request, env, user }) => {
      const body = ((await readJsonBody(request)) ?? {}) as Record<string, unknown>;
      if (body.side !== "home" && body.side !== "away") throw new HttpError("Choose the fixture and side.", 400, "INVALID_INPUT");
      await requireCoachOfMatchSide(env, user, String(body.matchId ?? ""), body.side);
      return noteSquadNotified(env, user.personId, body);
    },
    "coach-of-match-side",
  ),

  // A squad save as changes: only who was added and removed, merged with
  // anyone else's changes unless both touched the same player.
  route(
    "POST",
    "/api/squad/changes",
    "coach",
    async ({ request, env, user, origin }) => {
      const body = (await readJsonBody(request)) as SquadChangesBody;
      // The side this save writes to must be one of the coach's teams.
      const side = body.side === "home" || body.side === "away" ? body.side : undefined;
      await requireCoachOfMatchSide(env, user, String(body.matchId ?? ""), side);
      const result = await applySquadChanges(env, body, { email: user.email, personId: user.personId });
      if (result.status === "conflict") {
        const names = result.players.map((p) => p.name);
        const message = names.length > 0
          ? `Someone else changed ${names.join(", ")} in this squad. Check and save again.`
          : "Someone else changed this squad. Check and save again.";
        return json(
          { error: "SQUAD_CONFLICT", message, players: result.players, version: result.version, selectedIds: result.selectedIds },
          409,
          origin,
        );
      }
      return json(
        { success: true, version: result.version, selectedIds: result.selectedIds, displaced: result.displaced },
        200,
        origin,
      );
    },
    "coach-of-match-side",
  ),

  // ── Ranking ────────────────────────────────────────────────────────────
  // Ranking reads are coach-only: they expose every player's ability
  // ranking, and the ranking screen lives under /coach. The matching
  // writes below are already gated the same way.
  route("GET", "/api/ranking", "coach", ({ env }) => getActiveRanking(env)),
  route("GET", "/api/ranking/inactive", "coach", ({ env }) => getInactiveRanking(env)),
  route("POST", "/api/ranking/config", "coach", async ({ request, env, user }) => {
    const body = (await readJsonBody(request)) as { config: AbilityGroupConfigMap };
    return setAbilityGroupConfig(env, body.config, user);
  }),
  route(
    "POST",
    "/api/ranking/reorder",
    "coach",
    async ({ request, env, user }) => {
      const body = (await readJsonBody(request)) as {
        playerIds: string[];
        justification?: string;
      };
      // One section-wide ranking: a coach moves only their own teams'
      // players (ranking.ts); Section Captains and the Assistant Director anyone.
      const mayMove = coachesEveryTeam(user) ? undefined : (player: Player) => coachesPlayer(user, player);
      return reorderRanking(env, body.playerIds, user.email, body.justification, mayMove);
    },
    "coach-of-player",
  ),
  // Making a player active or inactive: Section Captains only (owner
  // decision, 2026-10-06), not every coach.
  route("POST", "/api/ranking/activate", "section-captain", async ({ request, env, user }) => {
    const body = (await readJsonBody(request)) as { playerId: string };
    return activatePlayer(env, body.playerId, user.email);
  }),
  route("POST", "/api/ranking/deactivate", "section-captain", async ({ request, env, user }) => {
    const body = (await readJsonBody(request)) as { playerId: string };
    return deactivatePlayer(env, body.playerId, user.email);
  }),

  // ── Membership section (Membership Officers + Section Captains table) ──
  // The board and the export expose applicants' contact details and notes,
  // so every route here is gated on the section, not on sign-in alone.
  route("GET", "/api/membership/board", "section:membership", ({ env }) => getMembershipBoard(env)),
  route("GET", "/api/membership/insights", "section:membership", ({ env }) => getMembershipInsights(env)),
  route("GET", "/api/membership/forms-due", "section:membership", ({ env }) => getFormsDue(env)),
  route("GET", "/api/membership/active-members", "section:membership", ({ env, user }) => getActiveMembersCsv(env, user)),
  route("GET", "/api/membership/number-holders", "section:membership", async ({ env, url }) => {
    const holders = await getNumberHolders(env, url.searchParams.get("membershipNo") ?? "", url.searchParams.get("exclude") ?? "");
    return { holders };
  }),
  route("POST", "/api/membership/approve", "section:membership", async ({ request, env, user }) => {
    const body = (await readJsonBody(request)) as Record<string, unknown>;
    return approveApplicant(env, user, {
      personId: String(body.personId ?? ""),
      joinDate: String(body.joinDate ?? ""),
      commitmentEndDate: String(body.commitmentEndDate ?? ""),
      membershipNo: String(body.membershipNo ?? ""),
      sharedNumberAcknowledged: body.sharedNumberAcknowledged === true,
    });
  }),
  route("GET", "/api/membership/statements", "section:membership", ({ env }) => getStatementBoard(env)),
  route("POST", "/api/membership/statements/notify", "section:membership", async ({ request, env, user }) => {
    const body = (await readJsonBody(request)) as Record<string, unknown>;
    return requestReviewEmail(env, user, String(body.commitmentId ?? ""));
  }),

  // ── Waivers & declarations (src/declarations.ts) ──────────────────────
  route("GET", "/api/declarations/me", "signed-in", ({ env, user }) => getMyDeclarations(env, user)),
  route("POST", "/api/declarations", "signed-in", async ({ request, env, user }) => {
    const body = (await readJsonBody(request)) as Record<string, unknown>;
    return submitDeclarations(env, user, body ?? {});
  }),

  // ── Season plan (src/seasonPlan.ts) ───────────────────────────────────
  // The player's own plan; the board decides per person which teams they see.
  route("GET", "/api/season-plan/me", "signed-in", ({ env, user }) => getMySeasonPlan(env, user)),
  route("POST", "/api/season-plan", "signed-in", async ({ request, env, user }) => {
    const body = (await readJsonBody(request)) as Record<string, unknown>;
    return submitSeasonPlan(env, user, body ?? {});
  }),
  route("GET", "/api/season-plan/board", "signed-in", ({ env, user }) => getSeasonPlanBoard(env, user)),

  // ── Personal details (src/details.ts) ─────────────────────────────────
  // The signed-in person's own details only. Every POST here reads its body
  // first, used or not (GUARDED_SCOPES below).
  route("GET", "/api/details/me", "signed-in", ({ env, user }) => getMyDetails(env, user)),
  route("POST", "/api/details/sections/:section([a-z]+)", "signed-in", async ({ request, env, user, params }) => saveSection(env, user, params.section, await readBodyOrEmpty(request))),
  route("POST", "/api/details/files/:kind([a-z]+)", "signed-in", async ({ request, env, user, params }) => uploadFile(env, user, params.kind, await readBodyOrEmpty(request))),
  route("POST", "/api/details/kit", "signed-in", async ({ request, env, user }) => saveKitSizes(env, user, await readBodyOrEmpty(request))),
  route("POST", "/api/details/read-id", "signed-in", async ({ request, env, user }) => readIdDocument(env, user, await readBodyOrEmpty(request))),
  route("POST", "/api/details/confirm", "signed-in", async ({ request, env, user }) => {
    await readBodyOrEmpty(request); // read, though unused, as before
    return confirmDetails(env, user);
  }),
  route("POST", "/api/details/delete-profile", "signed-in", async ({ request, env, user }) => deleteMyProfile(env, user, await readBodyOrEmpty(request))),

  // ── The new joiner form (src/apply.ts) ────────────────────────────────
  // The signed-in applicant's own application only.
  route("GET", "/api/apply/me", "signed-in", ({ env, user }) => getApply(env, user)),
  route("POST", "/api/apply/family", "signed-in", async ({ request, env, user }) => saveFamily(env, user, await readBodyOrEmpty(request))),
  route("POST", "/api/apply/clubs", "signed-in", async ({ request, env, user }) => saveClubs(env, user, await readBodyOrEmpty(request))),
  route("POST", "/api/apply/trials", "signed-in", async ({ request, env, user }) => saveTrials(env, user, await readBodyOrEmpty(request))),
  route("POST", "/api/apply/submit", "signed-in", async ({ request, env, user }) => submitApplication(env, user, await readBodyOrEmpty(request))),
  route("POST", "/api/apply/polish", "signed-in", async ({ request, env, user }) => polishAnswer(env, user, await readBodyOrEmpty(request))),
  route("POST", "/api/apply/files/:kind([a-z_]+)", "signed-in", async ({ request, env, user, params }) => uploadApplicantFile(env, user, null, params.kind, await readBodyOrEmpty(request))),
  route("POST", `/api/apply/family/:member(${UUID})/files/:kind([a-z_]+)`, "signed-in", async ({ request, env, user, params }) => uploadApplicantFile(env, user, params.member, params.kind, await readBodyOrEmpty(request))),

  // ── New joiners: the Section Captain's screens and the convenors' tasks
  // (worker/src/joiners.ts checks who may do what).
  route("GET", "/api/joiners/options", "signed-in", ({ env, user }) => getJoinerOptions(env, user)),
  route("GET", `/api/joiners/:id(${JOINER_ID})`, "signed-in", ({ env, user, params }) => getJoiner(env, user, params.id)),
  route("POST", "/api/joiners", "signed-in", async ({ request, env, user }) => createJoiner(env, user, await readBodyOrEmpty(request))),
  route("POST", `/api/joiners/:id(${JOINER_ID})`, "signed-in", async ({ request, env, user, params }) => updateJoiner(env, user, params.id, await readBodyOrEmpty(request))),
  route("POST", `/api/joiners/:id(${JOINER_ID})/invite`, "signed-in", async ({ request, env, user, params }) => {
    await readBodyOrEmpty(request); // read, though unused, as before
    return inviteJoiner(env, user, params.id);
  }),
  route("POST", `/api/joiners/:id(${JOINER_ID})/kit`, "signed-in", async ({ request, env, user, params }) => requestKit(env, user, params.id, await readBodyOrEmpty(request))),
  route("POST", `/api/joiners/:id(${JOINER_ID})/registration`, "signed-in", async ({ request, env, user, params }) => requestRegistration(env, user, params.id, await readBodyOrEmpty(request))),
  route("POST", `/api/joiners/:id(${JOINER_ID})/practice-trial`, "signed-in", async ({ request, env, user, params }) => invitePracticeTrial(env, user, params.id, await readBodyOrEmpty(request))),
  route("POST", `/api/joiners/:id(${JOINER_ID})/decline`, "signed-in", async ({ request, env, user, params }) => {
    await readBodyOrEmpty(request); // read, though unused, as before
    return declineRegistration(env, user, params.id);
  }),

  // ── Hockey Rules quizzes (quizzes.ts) ─────────────────────────────────
  route("GET", "/api/quizzes", "signed-in", ({ env, user }) => listQuizzes(env, user)),
  route("GET", "/api/quizzes/scores", "signed-in", ({ env, user }) => quizScoreBoard(env, user)),
  route("GET", "/api/quizzes/:key([^/]{1,80})", "signed-in", ({ env, user, params }) => getQuiz(env, user, decodeURIComponent(params.key))),
  route("POST", "/api/quizzes/:key([^/]{1,80})", "signed-in", async ({ request, env, user, params }) => {
    const key = decodeURIComponent(params.key);
    return submitQuiz(env, user, key, await readBodyOrEmpty(request));
  }),

  // ── Registering to join (trials.ts) ───────────────────────────────────
  // Signing up works off the confirmed email alone: there's no People record yet.
  route("POST", "/api/join/register", "verified-email", async ({ request, env, email }) => registerInterest(env, email, await readBodyOrEmpty(request))),
  route("GET", "/api/trials/me", "signed-in", ({ env, user }) => getMyTrial(env, user)),
  route("GET", "/api/trials/sessions", "signed-in", ({ env, user }) => listSessions(env, user)),
  route("POST", `/api/trials/sessions/:id(${UUID})/remove`, "signed-in", ({ env, user, params }) => removeSession(env, user, params.id)),
  route("POST", "/api/trials/me", "signed-in", async ({ request, env, user }) => saveMyTrial(env, user, await readBodyOrEmpty(request))),
  route("POST", "/api/trials/submit", "signed-in", async ({ request, env, user }) => {
    await readBodyOrEmpty(request); // read, though unused, as before
    return submitRegistration(env, user);
  }),
  route("POST", "/api/trials/sessions", "signed-in", async ({ request, env, user }) => addSession(env, user, await readBodyOrEmpty(request))),

  // ── Special events (events.ts) ────────────────────────────────────────
  route("GET", "/api/events/mine", "signed-in", ({ env, user }) => getMyEvents(env, user)),
  route("GET", "/api/events/manage", "signed-in", ({ env, user }) => getManageView(env, user)),
  route("GET", "/api/events/find-people", "signed-in", ({ env, user, url }) => findPeople(env, user, url.searchParams.get("q") ?? "")),
  route("GET", `/api/events/:id(${UUID})/people`, "signed-in", ({ env, user, url, params }) => searchEventPeople(env, user, params.id, url.searchParams.get("q") ?? "")),
  route("GET", `/api/events/:id(${UUID})/responses`, "signed-in", ({ env, user, params }) => getEventResponses(env, user, params.id)),
  route("GET", `/api/events/:id(${UUID})/charges`, "signed-in", ({ env, user, params }) => getCharges(env, user, params.id)),
  route("GET", `/api/events/:id(${UUID})/checkin`, "signed-in", ({ env, user, url, params }) => getCheckIn(env, user, params.id, url.searchParams.get("c") ?? "")),
  route("GET", `/api/events/:id(${UUID})/checkin-link`, "signed-in", ({ env, user, params }) => checkinLink(env, user, params.id)),
  route("POST", "/api/events", "signed-in", async ({ request, env, user }) => saveEvent(env, user, await readBodyOrEmpty(request))),
  route("POST", "/api/events/audience", "signed-in", async ({ request, env, user }) => countAudience(env, user, await readBodyOrEmpty(request))),
  route("POST", "/api/events/social-secretaries", "signed-in", async ({ request, env, user }) => setSocialSecretaries(env, user, await readBodyOrEmpty(request))),
  route("POST", `/api/events/:id(${UUID})/respond`, "signed-in", async ({ request, env, user, params }) => respondToEvent(env, user, params.id, await readBodyOrEmpty(request))),
  route("POST", `/api/events/:id(${UUID})/status`, "signed-in", async ({ request, env, user, params }) => setEventStatus(env, user, params.id, await readBodyOrEmpty(request))),
  route("POST", `/api/events/:id(${UUID})/poster`, "signed-in", async ({ request, env, user, params }) => uploadPoster(env, user, params.id, await readBodyOrEmpty(request))),
  route("POST", `/api/events/:id(${UUID})/delete`, "signed-in", async ({ request, env, user, params }) => {
    await readBodyOrEmpty(request); // read, though unused, as before
    return deleteEvent(env, user, params.id);
  }),
  route("POST", `/api/events/:id(${UUID})/charges-sent`, "signed-in", async ({ request, env, user, params }) => {
    await readBodyOrEmpty(request); // read, though unused, as before
    return markChargesSent(env, user, params.id);
  }),
  route("POST", `/api/events/:id(${UUID})/payment-proof`, "signed-in", async ({ request, env, user, params }) => uploadPaymentProof(env, user, params.id, await readBodyOrEmpty(request))),
  route("POST", `/api/events/:id(${UUID})/confirm-payment`, "signed-in", async ({ request, env, user, params }) => confirmPayment(env, user, params.id, await readBodyOrEmpty(request))),
  route("POST", `/api/events/:id(${UUID})/waive`, "signed-in", async ({ request, env, user, params }) => waiveCharge(env, user, params.id, await readBodyOrEmpty(request))),
  route("POST", `/api/events/:id(${UUID})/attendance`, "signed-in", async ({ request, env, user, params }) => setAttendance(env, user, params.id, await readBodyOrEmpty(request))),
  route("POST", `/api/events/:id(${UUID})/tick-everyone`, "signed-in", async ({ request, env, user, params }) => {
    await readBodyOrEmpty(request); // read, though unused, as before
    return tickEveryone(env, user, params.id);
  }),
  route("POST", `/api/events/:id(${UUID})/register-taken`, "signed-in", async ({ request, env, user, params }) => setRegisterTaken(env, user, params.id, await readBodyOrEmpty(request))),
  route("POST", `/api/events/:id(${UUID})/checkin`, "signed-in", async ({ request, env, user, params }) => checkIn(env, user, params.id, await readBodyOrEmpty(request))),

  // ── Signing new members' applications (applicationSigning.ts) ─────────
  route("GET", `/api/applications/:id(${JOINER_ID})/sign`, "signed-in", ({ env, user, params }) => getSigningView(env, user, params.id)),
  route("POST", `/api/applications/:id(${JOINER_ID})/drafts`, "signed-in", ({ env, user, params }) => draftSponsorAnswers(env, user, params.id)),
  route("POST", `/api/applications/:id(${JOINER_ID})/sign`, "signed-in", async ({ request, env, user, params }) => signApplication(env, user, params.id, await readBodyOrEmpty(request))),
  route("POST", `/api/applications/:id(${JOINER_ID})/pdf`, "signed-in", ({ env, user, params }) => remakeApplicationPdf(env, user, params.id)),
  route("POST", `/api/applications/:id(${JOINER_ID})/send`, "signed-in", async ({ request, env, user, params }) => sendApplicationOn(env, user, params.id, await readBodyOrEmpty(request))),
  // Club documents behind sign-in (shared/application.ts CLUB_DOCS).
  route("GET", "/api/club-docs/:name([a-z-]+)", "signed-in", ({ env, params, origin }) => serveClubDoc(env, params.name, origin)),
  // Ask to be reactivated (reactivation.ts): the asker has no access yet,
  // so only their email is checked; a captain's view and answer need sign-in.
  route("GET", "/api/reactivation", "verified-email", ({ env, email }) => reactivationStatus(env, email)),
  route("POST", "/api/reactivation", "verified-email", ({ env, email }) => askToBeReactivated(env, email)),
  route("GET", `/api/reactivation/:id(${UUID})`, "signed-in", ({ env, user, params }) => getReactivationRequest(env, user, params.id)),
  route("POST", `/api/reactivation/:id(${UUID})`, "signed-in", async ({ request, env, user, params }) => answerReactivation(env, user, params.id, await readJsonBody(request))),
  route("GET", `/api/joiner-tasks/:id(${UUID})`, "signed-in", ({ env, user, params }) => getJoinerTask(env, user, params.id)),
  route("POST", `/api/joiner-tasks/:id(${UUID})/done`, "signed-in", ({ env, user, params }) => completeJoinerTask(env, user, params.id)),

  // ── Officers' admin screens (src/admin/) ──────────────────────────────
  ...ADMIN_ROUTES,

  // ── HKHA registration (src/registration.ts) ───────────────────────────
  // HKID and passport numbers: the Hockey Convenor only.
  route("GET", "/api/registration/board", "section:registration", ({ env }) => getRegistrationBoard(env)),
  route("GET", "/api/registration/export", "section:registration", ({ env, user, url }) => {
    const opts = { todo: url.searchParams.get("todo") === "1", team: url.searchParams.get("team") || null };
    return registrationCsv(env, user, opts);
  }),
  route("POST", "/api/registration/registered", "section:registration", async ({ request, env, user }) => markRegistered(env, user, await readBodyOrEmpty(request))),
  route("POST", "/api/registration/unregistered", "section:registration", async ({ request, env, user }) => unmarkRegistered(env, user, await readBodyOrEmpty(request))),
  route("POST", "/api/registration/details", "section:registration", async ({ request, env, user }) => saveRegistrationDetails(env, user, await readBodyOrEmpty(request))),

  // ── Re-registrations to review (src/reRegistrations.ts) ───────────────
  // Data checks: the Men's Convenor and the Section Captains.
  route("POST", "/api/admin/registration-events/:id/resolve", "section:dataChecks", async ({ request, env, user, params }) => resolveRegistrationEvent(env, user, params.id, await readBodyOrEmpty(request))),

  // ── Suspensions (src/discipline.ts) ────────────────────────────────────
  // The Men's Convenor only.
  route("GET", "/api/discipline/suspensions", "section:discipline", ({ env }) => getSuspensionsBoard(env)),
  route("POST", "/api/discipline/suspensions", "section:discipline", async ({ request, env, user }) => createSuspension(env, user, await readBodyOrEmpty(request))),
  route("POST", "/api/discipline/suspensions/:id([^/]{1,64})/clear", "section:discipline", async ({ request, env, user, params }) => clearSuspension(env, user, params.id, await readBodyOrEmpty(request))),
  route("POST", "/api/discipline/suspensions/:id([^/]{1,64})", "section:discipline", async ({ request, env, user, params }) => updateSuspension(env, user, params.id, await readBodyOrEmpty(request))),
  route("POST", "/api/discipline/flags/:id([^/]{1,64})/clear", "section:discipline", ({ env, user, params }) => clearSuspensionFlag(env, user, params.id)),

  // ── Data checks (src/dataChecks.ts) ───────────────────────────────────
  // The Men's Convenor and the Section Captains.
  route("GET", "/api/admin/data-checks", "section:dataChecks", ({ env }) => getDataChecks(env)),
  route("POST", "/api/admin/match-cards/:id([^/]{1,64})/link", "section:dataChecks", async ({ request, env, user, params }) => linkMatchCard(env, user, params.id, await readBodyOrEmpty(request))),

  // ── Volunteering (src/volunteering.ts) ────────────────────────────────
  route("GET", "/api/volunteering/me", "signed-in", ({ env, user }) => getMyVolunteering(env, user)),
  route("POST", "/api/volunteering", "signed-in", async ({ request, env, user }) => {
    const body = (await readJsonBody(request)) as Record<string, unknown>;
    return saveVolunteering(env, user, body ?? {});
  }),
  route("GET", "/api/volunteering/board", "signed-in", ({ env, user }) => getVolunteersBoard(env, user)),

  // ── Umpiring duties (src/umpiring.ts) ─────────────────────────────────
  // The club's umpires take duties; the Umpire Coordinator (and the
  // Section Captains) confirms, assigns, marks no-shows and reports.
  route("GET", "/api/umpiring", "signed-in", ({ env, user, url }) => getUmpiringBoard(env, user, url.searchParams.get("week"))),
  // Opened from My Tasks: the umpire has seen their duties' changes (myDuties.ts).
  route("POST", "/api/umpiring/seen", "signed-in", ({ env, user }) => ackDutyChanges(env, user)),
  route("GET", "/api/umpiring/report", "signed-in", ({ env, user, url }) => getUmpiringReport(env, user, url.searchParams.get("season"))),
  route("POST", `/api/umpiring/duties/:id(${UUID})/take`, "signed-in", async ({ request, env, user, params }) => takeDuty(env, user, params.id, await readBodyOrEmpty(request))),
  route("POST", `/api/umpiring/duties/:id(${UUID})/assign`, "signed-in", async ({ request, env, user, params }) => assignDuty(env, user, params.id, await readBodyOrEmpty(request))),
  route("POST", `/api/umpiring/duties/:id(${UUID})/not-needed`, "signed-in", async ({ request, env, user, params }) => setNotNeeded(env, user, params.id, await readBodyOrEmpty(request))),
  route("POST", `/api/umpiring/assignments/:id(${UUID})/withdraw`, "signed-in", ({ env, user, params }) => withdrawAssignment(env, user, params.id)),
  route("POST", `/api/umpiring/assignments/:id(${UUID})/confirm`, "signed-in", ({ env, user, params }) => confirmAssignment(env, user, params.id)),
  route("POST", `/api/umpiring/assignments/:id(${UUID})/no-show`, "signed-in", async ({ request, env, user, params }) => setNoShow(env, user, params.id, await readBodyOrEmpty(request))),

  // ── Kit (src/kit.ts) ──────────────────────────────────────────────────
  // Anyone signed in sees their own kit and hands on what they hold; the
  // board, spares and orders are the kit section's (Kit Convenor, Section
  // Captains).
  route("GET", "/api/kit/me", "signed-in", ({ env, user }) => getMyKit(env, user)),
  route("POST", "/api/kit/move", "signed-in", async ({ request, env, user }) => {
    const body = (await readJsonBody(request)) as Record<string, unknown>;
    return moveKit(env, user, body ?? {});
  }),
  route("POST", "/api/kit/confirm", "signed-in", async ({ request, env, user }) => {
    const body = (await readJsonBody(request)) as Record<string, unknown>;
    return confirmKit(env, user, body ?? {});
  }),
  route("GET", "/api/kit/board", "section:kit", ({ env, url }) => getKitBoard(env, url.searchParams.get("order"))),
  route("GET", "/api/kit/uncollected", "section:kit", ({ env }) => getUncollectedKit(env)),
  route("GET", "/api/kit/top-up", "section:kit", ({ env, url }) => topUpCsv(env, url.searchParams.get("order"))),
  route("GET", "/api/kit/sets/:id/history", "section:kit", ({ env, params }) => getSetHistory(env, params.id)),
  route("POST", "/api/kit/sets/:id/sizes", "section:kit", async ({ request, env, user, params }) => editSizes(env, user, params.id, await readBodyOrEmpty(request))),
  route("POST", "/api/kit/allocate", "section:kit", async ({ request, env, user }) => allocateSpare(env, user, await readBodyOrEmpty(request))),
  route("POST", "/api/kit/release", "section:kit", async ({ request, env, user }) => releaseSet(env, user, await readBodyOrEmpty(request))),
  route("POST", "/api/kit/swap", "section:kit", async ({ request, env, user }) => swapItem(env, user, await readBodyOrEmpty(request))),
  route("POST", "/api/kit/new-number", "section:kit", async ({ request, env, user }) => giveNewNumber(env, user, await readBodyOrEmpty(request))),
  route("POST", "/api/kit/orders/:id/received", "section:kit", async ({ request, env, params }) => setOrderReceived(env, params.id, await readBodyOrEmpty(request))),
  route("POST", "/api/kit/orders/:id/expected", "section:kit", async ({ request, env, params }) => setOrderExpected(env, params.id, await readBodyOrEmpty(request))),

  // ── Commitment reviews (src/reviews.ts) ───────────────────────────────
  // Signed-in only: who may see or submit each review is decided per
  // review (the member, their sponsor, Membership Officers).
  route("GET", "/api/reviews/:id", "signed-in", ({ env, user, params }) => getReview(env, user, params.id)),
  route("POST", "/api/reviews/:id/:step(member|sponsor|officer)", "signed-in", async ({ request, env, user, params }) => {
    const body = (await readJsonBody(request)) as Record<string, unknown>;
    const submit = params.step === "member" ? submitMemberReport : params.step === "sponsor" ? submitSponsorReview : submitOfficerReview;
    return submit(env, user, params.id, body ?? {});
  }),

  // ── Chairman's section (Section Chairs + Section Captains table) ──────
  // The directory carries every member's email address, so it is gated on
  // the section like the membership routes.
  // "WhatsApp these people": templates and the message log (messages.ts).
  route("GET", "/api/messages/templates", "signed-in", ({ env, user }) => listTemplates(env, user)),
  route("POST", "/api/messages/log", "signed-in", async ({ request, env, user }) => logMessage(env, user, ((await readJsonBody(request)) ?? {}) as Record<string, unknown>)),
  // Web Push (push.ts): the app's switch, this device, and Notify's "Send to Eddy app".
  route("GET", "/api/push/config", "signed-in", ({ env }) => pushConfig(env)),
  route("POST", "/api/push/subscribe", "signed-in", async ({ request, env, user }) =>
    pushSubscribe(env, user, ((await readJsonBody(request)) ?? {}) as Record<string, unknown>, request.headers.get("User-Agent"))),
  route("POST", "/api/push/unsubscribe", "signed-in", async ({ request, env, user }) => pushUnsubscribe(env, user, ((await readJsonBody(request)) ?? {}) as Record<string, unknown>)),
  route("POST", "/api/push/squad", "signed-in", async ({ request, env, user }) => pushSquad(env, user, ((await readJsonBody(request)) ?? {}) as Record<string, unknown>)),
  route("GET", "/api/chairman/directory", "section:chairman", ({ env }) => getChairmanDirectory(env)),
  route("POST", "/api/chairman/export-log", "section:chairman", async ({ request, env, user }) => {
    const body = (await readJsonBody(request)) as Partial<EmailExportInput>;
    return logEmailExport(env, user, {
      kind: body.kind as EmailExportInput["kind"],
      people: Number(body.people),
      addresses: Number(body.addresses),
      description: String(body.description ?? ""),
    });
  }),

  // ── Calendar (Link generation needs sign-in, Feeds are public signed URLs) ──
  route("GET", "/api/calendar/link", "signed-in", ({ env, user, url }) => handleGetCalendarLink(env, user.personId, url.origin)),
  route("GET", "/api/calendar/feed.ics", "calendar-hmac", ({ env, url }) => handlePlayerCalendarFeed(env, url.searchParams.get("id"), url.searchParams.get("sig"), url.origin)),
  route("GET", "/api/calendar/team-link", "signed-in", ({ env, user, url }) => {
    const team = requireParam(url.searchParams.get("team"), "team");
    return handleGetTeamCalendarLink(env, user, team, url.origin);
  }),
  route("GET", "/api/calendar/team-feed.ics", "calendar-hmac", ({ env, url }) => handleTeamCalendarFeed(env, url.searchParams.get("team"), url.searchParams.get("sig"), url.origin)),
];

/**
 * Paths whose routes the old router grouped behind one sign-in check, which
 * it made before looking at the method or the rest of the path. A request
 * under one of these that matches no route still gets that check's 401 / 403
 * (and, for a POST where the group read its body first, a 400 for a body
 * that isn't JSON) before the 404, as it always has. Tried in this order,
 * only when no route matched; "*" at the end is a prefix.
 */
export const GUARDED_SCOPES: readonly Scope[] = [
  scope("/api/details/*", "signed-in", { postBody: true }),
  scope("/api/apply/*", "signed-in", { postBody: true }),
  scope("/api/joiners*", "signed-in", { postBody: true }),
  scope("/api/quizzes", "signed-in"),
  scope("/api/quizzes/*", "signed-in"),
  scope("/api/trials/*", "signed-in", { postBody: true }),
  scope("/api/events*", "signed-in", { postBody: true }),
  scope(`/api/applications/:id(${JOINER_ID})/:step(sign|drafts|pdf|send)`, "signed-in"),
  scope("/api/reactivation", "verified-email"),
  scope(`/api/reactivation/:id(${UUID})`, "signed-in"),
  scope("/api/joiner-tasks/*", "signed-in"),
  scope("/api/registration/*", "section:registration", { postBody: true }),
  scope("/api/discipline/*", "section:discipline", { postBody: true }),
  scope("/api/umpiring*", "signed-in"),
  scope("/api/kit/*", "section:kit", { postBody: true }),
  scope("/api/reviews/:id", "signed-in"),
  scope("/api/reviews/:id/:step(member|sponsor|officer)", "signed-in"),
];
