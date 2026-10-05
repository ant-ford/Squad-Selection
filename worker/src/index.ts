import { AirtableError, airtableList } from "./airtable";
import { getCached } from "./cache";
import { handleFileRequest, serveClubDoc } from "./files";
import { db, SupabaseError } from "./data/supabase";
import { shadowSummary } from "./data/shadow";
import { backendFor } from "./data/backend";
import { sendDueReviewEmails } from "./reviewEmails";
import { RETENTION_CRON, runRetention } from "./retention";
import { TABLES } from "../../shared/schema/tableNames";
import type { Env } from "./env";
import {
  json,
  errorJson,
  handleOptions,
  requireParam,
  HttpError,
  parseAllowedOrigins,
  resolveOrigin,
} from "./http";
import { requireAuthorizedUser, requireCoach, requireSection, requireVerifiedEmail } from "./auth";
import { approveApplicant, getActiveMembersCsv, getMembershipBoard, getMembershipInsights, getNumberHolders } from "./membership";
import { getStatementBoard, requestReviewEmail } from "./statements";
import { getReview, submitMemberReport, submitOfficerReview, submitSponsorReview } from "./reviews";
import { getMyDeclarations, submitDeclarations } from "./declarations";
import { getMySeasonPlan, getSeasonPlanBoard, submitSeasonPlan } from "./seasonPlan";
import { getMyVolunteering, getVolunteersBoard, saveVolunteering } from "./volunteering";
import { assignDuty, confirmAssignment, getUmpiringBoard, getUmpiringReport, setNoShow, takeDuty, withdrawAssignment } from "./umpiring";
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
  giveNewNumber,
  moveKit,
  releaseSet,
  setOrderExpected,
  setOrderReceived,
  swapItem,
  topUpCsv,
} from "./kit";
import { getRegistrationBoard, markRegistered, registrationCsv, unmarkRegistered } from "./registration";
import { getMyTasks } from "./myTasks";
import { getSeasonStats } from "./clubStats";
import { getChairmanDirectory, logEmailExport, type EmailExportInput } from "./chairman";
import { getMyProfile } from "./profile";
import { getMyFixtures, getUpcomingFixtures } from "./fixtures";
import {
  getPlayersForMatch,
  getSquadForMatch,
  getAvailabilityForMatch,
  syncSquad,
  setMatchKit,
  toggleAutoSelect,
  getTeamAutoSelectPlayers,
  setTeamAutoSelectPlayers,
} from "./squad";
import { setMyAvailability, setMyAvailabilityForDate, setPlayerAvailability, setPlayerOptInOnly } from "./availability";
import { createAvailabilityRule, deleteAvailabilityRule, getRulesForPlayer } from "./availabilityRules";
import { getRecommendationsForMatch, getTeamAvailabilityForMatch } from "./recommendations";
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
  movePlayerToRank,
  movePlayerRelative,
  reorderRanking,
  activatePlayer,
  deactivatePlayer,
} from "./ranking";
import type { AbilityGroupConfigMap } from "../../shared/schema/domainTypes";
import { getRecentChanges } from "./dashboard";
import { getPlayerSeasonStats } from "./playerStats";
import { getPlayerAttendance } from "./playerAttendance";
import { handleAirtableWebhook, refreshAirtableWebhook, WEBHOOK_ROUTE } from "./airtableWebhook";
import { newRequestStats, runWithRequestContext, serverTimingHeader } from "./requestContext";

export type { Env };

async function readJsonBody(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    throw new HttpError("Request body must be valid JSON", 400);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    if (parseAllowedOrigins(env.ALLOWED_ORIGIN).length === 0) {
      console.error("Server misconfigured: ALLOWED_ORIGIN is not set");
      return new Response(
        JSON.stringify({ error: "SERVER_MISCONFIGURED", message: "Server misconfigured: ALLOWED_ORIGIN is not set" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    // Every request runs inside its own context (requestContext.ts): the
    // Airtable client and the caches count what they do into it, and cache
    // invalidation can hand slow KV housekeeping to ctx.waitUntil. The
    // numbers go out as a Server-Timing header, readable in the browser's
    // Timing tab, and as one structured log line per request in Workers
    // Logs - the "is it Airtable or is it us" question, answered per call.
    const stats = newRequestStats();
    const startedAt = Date.now();
    const waitUntil = ctx?.waitUntil ? (p: Promise<unknown>) => ctx.waitUntil(p) : undefined;
    return runWithRequestContext({ stats, waitUntil }, async () => {
      let response: Response;
      try {
        response = await handleRequest(request, env);
      } catch (err) {
        console.error("Unhandled worker error:", err instanceof Error ? err.stack : err);
        response = errorJson("Internal Server Error", 500, resolveOrigin(request, env.ALLOWED_ORIGIN));
      }
      const totalMs = Date.now() - startedAt;
      const { pathname } = new URL(request.url);
      if (pathname !== "/health") {
        console.log(
          "request " +
            JSON.stringify({
              method: request.method,
              path: pathname,
              status: response.status,
              ms: totalMs,
              airtableCalls: stats.airtableCalls,
              airtableMs: Math.round(stats.airtableMs),
              airtableBytes: stats.airtableBytes,
              airtable429s: stats.airtableRateLimited,
              ...(stats.dbCalls > 0 ? { dbCalls: stats.dbCalls, dbMs: Math.round(stats.dbMs), dbBytes: stats.dbBytes } : {}),
              cacheHits: stats.cacheHits,
              cacheMisses: stats.cacheMisses,
              kvHits: stats.kvHits,
            }),
        );
      }
      const timed = new Response(response.body, response);
      timed.headers.set("Server-Timing", serverTimingHeader(stats, totalMs));
      // Without this a cross-origin caller (the app) cannot read the header.
      timed.headers.set("Timing-Allow-Origin", resolveOrigin(request, env.ALLOWED_ORIGIN));
      return timed;
    });
  },

  /**
   * Daily: keep the Airtable webhook from lapsing (airtableWebhook.ts), and
   * on the Supabase backend send the commitment review emails that are due
   * (reviewEmails.ts) - the job the Airtable 60-day automation did.
   * RETENTION_CRON, half an hour later, is the data retention job
   * (retention.ts), on its own so it has a run's outside calls to itself.
   */
  async scheduled(event: { cron: string }, env: Env): Promise<void> {
    if (event.cron === RETENTION_CRON) {
      if (backendFor(env, "people") === "supabase") await runRetention(env);
      return;
    }
    await refreshAirtableWebhook(env);
    if (backendFor(env, "commitments") === "supabase") await sendDueReviewEmails(env);
  },
};

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const origin = resolveOrigin(request, env.ALLOWED_ORIGIN);
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  if (method === "OPTIONS") return handleOptions(origin);

  // Airtable's change notifications. Signed by Airtable, not by a user
  // session, so it sits outside the authenticated routes; airtableWebhook.ts
  // verifies the signature and answers 404 until a webhook is configured.
  if (pathname === WEBHOOK_ROUTE) return handleAirtableWebhook(request, env);

  try {
    // ── Health Check (Public) ──────────────────────────────────────────────
    if (method === "GET" && pathname === "/health") {
      // ?deep=1 additionally reports whether the Worker's own credentials
      // still work. Plain /health only proves the Worker is running, which is
      // exactly why a rejected Airtable token once looked like a frontend
      // fault: sign-in succeeded, /health was green, and every screen behind
      // the login failed. There is no unauthenticated route that touches
      // Airtable, so confirming the token previously meant signing in.
      //
      // Reports "ok" or "error" and nothing else - no message, no record, no
      // configuration. The detail stays in Workers Logs. Cached for 60s so it
      // cannot be used to hammer Airtable.
      if (url.searchParams.get("deep") === "1") {
        const { data: airtable } = await getCached<"ok" | "error">(
          "health:airtable",
          async () => {
            try {
              await airtableList(env, TABLES.team, { maxRecords: "1" });
              return "ok";
            } catch (err) {
              console.error("Health check: Airtable unreachable:", err instanceof Error ? err.message : err);
              return "error";
            }
          },
          60 * 1000,
        );
        // The Supabase data project, once one is configured - same rules: ok or error, nothing more.
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
        // Preview only: this isolate's shadow-read comparison counts (no values, no ids).
        const shadow = env.DATA_SHADOW_READ === "on" ? shadowSummary() : undefined;
        return json({ status: "ok", airtable, ...(supabase ? { supabase } : {}), ...(shadow ? { shadow } : {}), timestamp: new Date().toISOString() }, 200, origin);
      }
      return json({ status: "ok", timestamp: new Date().toISOString() }, 200, origin);
    }

    // ── Stored files (signed link, no session - see files.ts) ─────────────
    const fileMatch = pathname.match(/^\/api\/files\/([0-9a-f-]{36})$/);
    if (method === "GET" && fileMatch) return await handleFileRequest(env, fileMatch[1], url);

    // ── Match / Squad (Read - Authenticated) ───────────────────────────────
    // The squad list is player-facing: PlayerAvailabilitySheet shows a player
    // who else is in the squad before they set their own availability.
    const matchSquadMatch = pathname.match(/^\/api\/match\/([^/]+)\/squad$/);
    if (method === "GET" && matchSquadMatch) {
      await requireAuthorizedUser(request, env);
      const side = url.searchParams.get("side") as "home" | "away" | null;
      return json(await getSquadForMatch(env, matchSquadMatch[1], side ?? undefined), 200, origin);
    }

    // Also player-facing: the fixture sheet's selected / rest-of-team /
    // suggestions lists. Names, positions and statuses only - see
    // getTeamAvailabilityForMatch for what is left out and why.
    const matchTeamAvailMatch = pathname.match(/^\/api\/match\/([^/]+)\/team-availability$/);
    if (method === "GET" && matchTeamAvailMatch) {
      await requireAuthorizedUser(request, env);
      const side = url.searchParams.get("side") as "home" | "away" | null;
      return json(await getTeamAvailabilityForMatch(env, matchTeamAvailMatch[1], side ?? undefined), 200, origin);
    }

    // The remaining match reads back the coach-only selection screens.
    const matchPlayersMatch = pathname.match(/^\/api\/match\/([^/]+)\/players$/);
    if (method === "GET" && matchPlayersMatch) {
      await requireCoach(request, env);
      const side = url.searchParams.get("side") as "home" | "away" | null;
      return json(
        await getPlayersForMatch(env, matchPlayersMatch[1], side ?? undefined),
        200,
        origin,
      );
    }

    const matchRecsMatch = pathname.match(/^\/api\/match\/([^/]+)\/recommendations$/);
    if (method === "GET" && matchRecsMatch) {
      await requireCoach(request, env);
      const side = url.searchParams.get("side") as "home" | "away" | null;
      const position = url.searchParams.get("position") ?? undefined;
      const limitParam = url.searchParams.get("limit");
      return json(
        await getRecommendationsForMatch(
          env,
          matchRecsMatch[1],
          side ?? undefined,
          position,
          limitParam ? Number(limitParam) : undefined,
          url.searchParams.get("includeSelected") === "1",
        ),
        200,
        origin,
      );
    }

    const matchAvailabilityMatch = pathname.match(/^\/api\/match\/([^/]+)\/availability$/);
    if (method === "GET" && matchAvailabilityMatch) {
      await requireCoach(request, env);
      return json(await getAvailabilityForMatch(env, matchAvailabilityMatch[1]), 200, origin);
    }
    // A coach answering for a player who cannot get into the app. The only
    // write that names another person, so it is coach-gated and the coach's
    // identity - from the session, never the body - goes on the record.
    if (method === "POST" && matchAvailabilityMatch) {
      const user = await requireCoach(request, env);
      const body = (await readJsonBody(request)) as { playerId?: string; status?: string; notes?: string };
      return json(
        await setPlayerAvailability(env, {
          coachPersonId: user.personId,
          playerId: String(body.playerId || ""),
          matchId: matchAvailabilityMatch[1],
          status: (body.status || "") as "Available" | "Maybe" | "Unavailable",
          notes: typeof body.notes === "string" ? body.notes : undefined,
        }),
        200,
        origin,
      );
    }

    // ── Opt-In Only (Write - Coach) ────────────────────────────────────────
    // Inverts the club's opt-out default for one player, so every fixture
    // they have not answered counts as Unavailable. Coach-only on purpose:
    // it exists for players who are not maintaining their own status, so it
    // must not be something they can switch off.
    const optInOnlyMatch = pathname.match(/^\/api\/player\/([^/]+)\/opt-in-only$/);
    if (method === "POST" && optInOnlyMatch) {
      const user = await requireCoach(request, env);
      const body = (await readJsonBody(request)) as { optInOnly?: unknown };
      if (typeof body.optInOnly !== "boolean") {
        throw new HttpError("optInOnly must be a boolean", 400);
      }
      return json(
        await setPlayerOptInOnly(env, {
          coachEmail: user.email,
          playerId: optInOnlyMatch[1],
          optInOnly: body.optInOnly,
        }),
        200,
        origin,
      );
    }

    // ── Auto-Select Toggle (Write - Authenticated) ─────────────────────────
    const autoSelectMatch = pathname.match(/^\/api\/match\/([^/]+)\/auto-select$/);
    if (method === "POST" && autoSelectMatch) {
      const user = await requireCoach(request, env);
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

      return json(
        await toggleAutoSelect(env, autoSelectMatch[1], enabled, user.email),
        200,
        origin,
      );
    }

    // ── Standing Availability Rules (Self-service) ─────────────────────────
    // Identity always comes from the session: a player can only read, add
    // or remove their OWN rules.
    if (method === "GET" && pathname === "/api/my-availability-rules") {
      const user = await requireAuthorizedUser(request, env);
      return json({ rules: await getRulesForPlayer(env, user.personId) }, 200, origin);
    }
    if (method === "POST" && pathname === "/api/my-availability-rules") {
      const user = await requireAuthorizedUser(request, env);
      const body = await readJsonBody(request);
      return json(
        await createAvailabilityRule(env, user.personId, {
          ruleType: String(body.ruleType ?? ""),
          availability: String(body.availability ?? ""),
          startDate: body.startDate ? String(body.startDate) : undefined,
          endDate: body.endDate ? String(body.endDate) : undefined,
          notes: body.notes ? String(body.notes) : undefined,
        }),
        200,
        origin,
      );
    }
    const deleteRuleMatch = pathname.match(/^\/api\/my-availability-rules\/([^/]+)$/);
    if (method === "POST" && deleteRuleMatch) {
      const user = await requireAuthorizedUser(request, env);
      return json(
        await deleteAvailabilityRule(env, user.personId, deleteRuleMatch[1]),
        200,
        origin,
      );
    }

    // ── Kit Colour (Write - Coach) ─────────────────────────────────────────
    const matchKitMatch = pathname.match(/^\/api\/match\/([^/]+)\/kit$/);
    if (method === "POST" && matchKitMatch) {
      const user = await requireCoach(request, env);
      const body = await readJsonBody(request);
      const side = body.side === "away" ? "away" : body.side === "home" ? "home" : undefined;
      if (!side) throw new HttpError('side must be "home" or "away"', 400);
      const kit = typeof body.kit === "string" ? body.kit : "";
      return json(
        await setMatchKit(env, matchKitMatch[1], side, kit, user.email),
        200,
        origin,
      );
    }

    // ── Priority Player List (Read/Write - Authenticated) ──────────────────
    if (method === "GET" && pathname === "/api/team/auto-select-players") {
      await requireCoach(request, env);
      const teamName = requireParam(url.searchParams.get("team"), "team");
      return json(await getTeamAutoSelectPlayers(env, teamName), 200, origin);
    }
    if (method === "POST" && pathname === "/api/team/auto-select-players") {
      const user = await requireCoach(request, env);
      const body = await readJsonBody(request);
      const teamName = requireParam(body.teamName, "teamName");
      return json(
        await setTeamAutoSelectPlayers(env, teamName, body.playerIds || [], user.email),
        200,
        origin,
      );
    }

    // ── Player Season Stats (Read - Self or Coach) ─────────────────────────
    // Backs the player's own stats panel and the coach drill-in from the
    // ranking / selection screens, so the same gate as player-fixtures.
    const playerStatsMatch = pathname.match(/^\/api\/player-stats\/([^/]+)$/);
    if (method === "GET" && playerStatsMatch) {
      const user = await requireAuthorizedUser(request, env);
      if (user.role !== "coach" && user.personId !== playerStatsMatch[1]) {
        throw new HttpError("Coach access required.", 403, "COACH_ACCESS_REQUIRED");
      }
      return json(await getPlayerSeasonStats(env, playerStatsMatch[1]), 200, origin);
    }

    // ── Player Attendance Grid (Read - Self or Coach) ──────────────────────
    // Past attendance and future availability per fixture; same gate as stats.
    const playerAttendanceMatch = pathname.match(/^\/api\/player-attendance\/([^/]+)$/);
    if (method === "GET" && playerAttendanceMatch) {
      const user = await requireAuthorizedUser(request, env);
      if (user.role !== "coach" && user.personId !== playerAttendanceMatch[1]) {
        throw new HttpError("Coach access required.", 403, "COACH_ACCESS_REQUIRED");
      }
      return json(await getPlayerAttendance(env, playerAttendanceMatch[1]), 200, origin);
    }

    // Player-facing routes: identity always comes from the verified Supabase
    // session, never from client-supplied email query parameters.
    if (method === "GET" && pathname === "/api/my-profile") {
      const user = await requireAuthorizedUser(request, env);
      return json(await getMyProfile(env, user), 200, origin);
    }
    // Club, team and player statistics, one season per request (clubStats.ts).
    if (method === "GET" && pathname === "/api/stats/season") {
      const user = await requireAuthorizedUser(request, env);
      return json(await getSeasonStats(env, user, url.searchParams.get("season") ?? ""), 200, origin);
    }
    if (method === "GET" && pathname === "/api/my-tasks") {
      const user = await requireAuthorizedUser(request, env);
      return json(await getMyTasks(env, user), 200, origin);
    }
    if (method === "GET" && pathname === "/api/my-fixtures") {
      const user = await requireAuthorizedUser(request, env);
      // Results are a meaningful amount of payload for a screen most players
      // open to answer an upcoming fixture, so they come only on request.
      const includePast = url.searchParams.get("past") === "1";
      return json(await getMyFixtures(env, user, { includePast }), 200, origin);
    }
    if (method === "GET" && pathname === "/api/upcoming-fixtures") {
      const user = await requireAuthorizedUser(request, env);
      const team = url.searchParams.get("team") ?? undefined;
      // Recently played matches cost an extra Airtable read, so the coach
      // list asks for them only while "Show past" is on.
      const includePast = url.searchParams.get("past") === "1";
      return json(await getUpcomingFixtures(env, { user, team, includePast }), 200, origin);
    }

    // Dashboard metrics (Coach) - expose every player's rank moves / play-up counts.
    if (method === "GET" && pathname === "/api/recent-changes") {
      await requireCoach(request, env);
      const days = Number(url.searchParams.get("days") ?? 7);
      return json(
        await getRecentChanges(env, Number.isFinite(days) && days > 0 ? days : 7),
        200,
        origin,
      );
    }

    // Player self-service availability: identity comes from the session, so a
    // caller cannot update another person's availability via body.email.
    // Date-level bulk availability (special goalkeeper view UX shortcut):
    // performs the existing match-level updates for every HKFC fixture on
    // the date. Identity comes from the verified Supabase session.
    if (method === "POST" && pathname === "/api/set-my-availability-for-date") {
      const user = await requireAuthorizedUser(request, env);
      const body = (await readJsonBody(request)) as { date?: string; status?: string; notes?: string };
      return json(
        await setMyAvailabilityForDate(env, {
          email: user.email,
          date: body.date || "",
          status: (body.status || "") as "Available" | "Maybe" | "Unavailable",
          notes: body.notes,
        }),
        200,
        origin,
      );
    }

    if (method === "POST" && pathname === "/api/set-my-availability") {
      const user = await requireAuthorizedUser(request, env);
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
      return json(
        await setMyAvailability(env, {
          email: user.email,
          matchId: body.matchId || "",
          status: (body.status || "") as "Available" | "Maybe" | "Unavailable",
          notes: body.notes,
        }),
        200,
        origin,
      );
    }

    if (method === "POST" && pathname === "/api/squad/sync") {
      const user = await requireCoach(request, env);
      const body = (await readJsonBody(request)) as {
        matchId: string;
        selectedIds: string[];
        side?: "home" | "away";
      };
      const { displaced } = await syncSquad(env, body.matchId, body.selectedIds, user.email, body.side);
      return json({ success: true, displaced }, 200, origin);
    }

    // ── Ranking ────────────────────────────────────────────────────────────
    // Ranking reads are coach-only: they expose every player's ability
    // ranking, and the ranking screen lives under /coach. The matching
    // writes below are already gated the same way.
    if (method === "GET" && pathname === "/api/ranking") {
      await requireCoach(request, env);
      return json(await getActiveRanking(env), 200, origin);
    }
    if (method === "GET" && pathname === "/api/ranking/inactive") {
      await requireCoach(request, env);
      return json(await getInactiveRanking(env), 200, origin);
    }
    if (method === "POST" && pathname === "/api/ranking/config") {
      const user = await requireCoach(request, env);
      const body = (await readJsonBody(request)) as { config: AbilityGroupConfigMap };
      const rankingList = await setAbilityGroupConfig(env, body.config, user);
      return json(rankingList, 200, origin);
    }
    if (method === "POST" && pathname === "/api/ranking/move") {
      const user = await requireCoach(request, env);
      const body = (await readJsonBody(request)) as {
        playerId: string;
        newRank: number;
        justification?: string;
      };
      return json(
        await movePlayerToRank(env, body.playerId, body.newRank, user.email, body.justification),
        200,
        origin,
      );
    }
    if (method === "POST" && pathname === "/api/ranking/move-relative") {
      const user = await requireCoach(request, env);
      const body = (await readJsonBody(request)) as {
        sourceId: string;
        targetId: string;
        position: "above" | "below";
        justification?: string;
      };
      return json(
        await movePlayerRelative(
          env,
          body.sourceId,
          body.targetId,
          body.position,
          user.email,
          body.justification,
        ),
        200,
        origin,
      );
    }
    if (method === "POST" && pathname === "/api/ranking/reorder") {
      const user = await requireCoach(request, env);
      const body = (await readJsonBody(request)) as {
        playerIds: string[];
        justification?: string;
      };
      return json(
        await reorderRanking(env, body.playerIds, user.email, body.justification),
        200,
        origin,
      );
    }
    if (method === "POST" && pathname === "/api/ranking/activate") {
      const user = await requireCoach(request, env);
      const body = (await readJsonBody(request)) as { playerId: string };
      return json(await activatePlayer(env, body.playerId, user.email), 200, origin);
    }
    if (method === "POST" && pathname === "/api/ranking/deactivate") {
      const user = await requireCoach(request, env);
      const body = (await readJsonBody(request)) as { playerId: string };
      return json(await deactivatePlayer(env, body.playerId, user.email), 200, origin);
    }
    // ── Membership section (Membership Officers + Section Captains table) ──
    // The board and the export expose applicants' contact details and notes,
    // so every route here is gated on the section, not on sign-in alone.
    if (method === "GET" && pathname === "/api/membership/board") {
      await requireSection(request, env, "membership");
      return json(await getMembershipBoard(env), 200, origin);
    }
    if (method === "GET" && pathname === "/api/membership/insights") {
      await requireSection(request, env, "membership");
      return json(await getMembershipInsights(env), 200, origin);
    }
    if (method === "GET" && pathname === "/api/membership/active-members") {
      const user = await requireSection(request, env, "membership");
      return json(await getActiveMembersCsv(env, user), 200, origin);
    }
    if (method === "GET" && pathname === "/api/membership/number-holders") {
      await requireSection(request, env, "membership");
      const holders = await getNumberHolders(
        env,
        url.searchParams.get("membershipNo") ?? "",
        url.searchParams.get("exclude") ?? "",
      );
      return json({ holders }, 200, origin);
    }
    if (method === "POST" && pathname === "/api/membership/approve") {
      const user = await requireSection(request, env, "membership");
      const body = (await readJsonBody(request)) as Record<string, unknown>;
      return json(
        await approveApplicant(env, user, {
          personId: String(body.personId ?? ""),
          joinDate: String(body.joinDate ?? ""),
          commitmentEndDate: String(body.commitmentEndDate ?? ""),
          membershipNo: String(body.membershipNo ?? ""),
          sharedNumberAcknowledged: body.sharedNumberAcknowledged === true,
        }),
        200,
        origin,
      );
    }

    if (method === "GET" && pathname === "/api/membership/statements") {
      await requireSection(request, env, "membership");
      return json(await getStatementBoard(env), 200, origin);
    }
    if (method === "POST" && pathname === "/api/membership/statements/notify") {
      const user = await requireSection(request, env, "membership");
      const body = (await readJsonBody(request)) as Record<string, unknown>;
      return json(await requestReviewEmail(env, user, String(body.commitmentId ?? "")), 200, origin);
    }

    // ── Waivers & declarations (Supabase backend; src/declarations.ts) ────
    if (method === "GET" && pathname === "/api/declarations/me") {
      const user = await requireAuthorizedUser(request, env);
      return json(await getMyDeclarations(env, user), 200, origin);
    }
    if (method === "POST" && pathname === "/api/declarations") {
      const user = await requireAuthorizedUser(request, env);
      const body = (await readJsonBody(request)) as Record<string, unknown>;
      return json(await submitDeclarations(env, user, body ?? {}), 200, origin);
    }

    // ── Season plan (Supabase backend; src/seasonPlan.ts) ─────────────────
    // The player's own plan; the board decides per person which teams they see.
    if (method === "GET" && pathname === "/api/season-plan/me") {
      const user = await requireAuthorizedUser(request, env);
      return json(await getMySeasonPlan(env, user), 200, origin);
    }
    if (method === "POST" && pathname === "/api/season-plan") {
      const user = await requireAuthorizedUser(request, env);
      const body = (await readJsonBody(request)) as Record<string, unknown>;
      return json(await submitSeasonPlan(env, user, body ?? {}), 200, origin);
    }
    if (method === "GET" && pathname === "/api/season-plan/board") {
      const user = await requireAuthorizedUser(request, env);
      return json(await getSeasonPlanBoard(env, user), 200, origin);
    }

    // ── Personal details (Supabase backend; src/details.ts) ───────────────
    // The signed-in person's own details only.
    if (pathname.startsWith("/api/details/")) {
      const user = await requireAuthorizedUser(request, env);
      if (method === "GET" && pathname === "/api/details/me") return json(await getMyDetails(env, user), 200, origin);
      if (method === "POST") {
        const body = ((await readJsonBody(request)) ?? {}) as Record<string, unknown>;
        const section = pathname.match(/^\/api\/details\/sections\/([a-z]+)$/);
        if (section) return json(await saveSection(env, user, section[1], body), 200, origin);
        const upload = pathname.match(/^\/api\/details\/files\/([a-z]+)$/);
        if (upload) return json(await uploadFile(env, user, upload[1], body), 200, origin);
        if (pathname === "/api/details/kit") return json(await saveKitSizes(env, user, body), 200, origin);
        if (pathname === "/api/details/read-id") return json(await readIdDocument(env, user, body), 200, origin);
        if (pathname === "/api/details/confirm") return json(await confirmDetails(env, user), 200, origin);
        if (pathname === "/api/details/delete-profile") return json(await deleteMyProfile(env, user, body), 200, origin);
      }
    }

    // ── The new joiner form (Supabase backend; src/apply.ts) ───────────────
    // The signed-in applicant's own application only.
    if (pathname.startsWith("/api/apply/")) {
      const user = await requireAuthorizedUser(request, env);
      if (method === "GET" && pathname === "/api/apply/me") return json(await getApply(env, user), 200, origin);
      if (method === "POST") {
        const body = ((await readJsonBody(request)) ?? {}) as Record<string, unknown>;
        if (pathname === "/api/apply/family") return json(await saveFamily(env, user, body), 200, origin);
        if (pathname === "/api/apply/clubs") return json(await saveClubs(env, user, body), 200, origin);
        if (pathname === "/api/apply/trials") return json(await saveTrials(env, user, body), 200, origin);
        if (pathname === "/api/apply/submit") return json(await submitApplication(env, user, body), 200, origin);
        if (pathname === "/api/apply/polish") return json(await polishAnswer(env, user, body), 200, origin);
        const own = pathname.match(/^\/api\/apply\/files\/([a-z_]+)$/);
        if (own) return json(await uploadApplicantFile(env, user, null, own[1], body), 200, origin);
        const family = pathname.match(/^\/api\/apply\/family\/([0-9a-f-]{36})\/files\/([a-z_]+)$/);
        if (family) return json(await uploadApplicantFile(env, user, family[1], family[2], body), 200, origin);
      }
    }

    // ── New joiners: the Section Captain's screens and the convenors' tasks
    // (Supabase backend; worker/src/joiners.ts checks who may do what).
    if (pathname.startsWith("/api/joiners")) {
      const user = await requireAuthorizedUser(request, env);
      if (method === "GET" && pathname === "/api/joiners/options") return json(await getJoinerOptions(env, user), 200, origin);
      const one = pathname.match(/^\/api\/joiners\/([A-Za-z0-9-]{3,40})(?:\/(invite|kit|registration|practice-trial|decline))?$/);
      if (method === "GET" && one && !one[2]) return json(await getJoiner(env, user, one[1]), 200, origin);
      if (method === "POST") {
        const body = ((await readJsonBody(request)) ?? {}) as Record<string, unknown>;
        if (pathname === "/api/joiners") return json(await createJoiner(env, user, body), 200, origin);
        if (one && !one[2]) return json(await updateJoiner(env, user, one[1], body), 200, origin);
        if (one?.[2] === "invite") return json(await inviteJoiner(env, user, one[1]), 200, origin);
        if (one?.[2] === "kit") return json(await requestKit(env, user, one[1], body), 200, origin);
        if (one?.[2] === "registration") return json(await requestRegistration(env, user, one[1], body), 200, origin);
        if (one?.[2] === "practice-trial") return json(await invitePracticeTrial(env, user, one[1], body), 200, origin);
        if (one?.[2] === "decline") return json(await declineRegistration(env, user, one[1]), 200, origin);
      }
    }
    // ── Hockey Rules quizzes (Supabase; quizzes.ts) ───────────────────────
    if (pathname === "/api/quizzes" || pathname.startsWith("/api/quizzes/")) {
      const user = await requireAuthorizedUser(request, env);
      if (method === "GET" && pathname === "/api/quizzes") return json(await listQuizzes(env, user), 200, origin);
      if (method === "GET" && pathname === "/api/quizzes/scores") return json(await quizScoreBoard(env, user), 200, origin);
      const quiz = pathname.match(/^\/api\/quizzes\/([^/]{1,80})$/);
      if (quiz) {
        const key = decodeURIComponent(quiz[1]);
        if (method === "GET") return json(await getQuiz(env, user, key), 200, origin);
        if (method === "POST") {
          const body = ((await readJsonBody(request)) ?? {}) as Record<string, unknown>;
          return json(await submitQuiz(env, user, key, body), 200, origin);
        }
      }
    }

    // ── Registering to join (Supabase; trials.ts) ─────────────────────────
    // Signing up works off the confirmed email alone: there's no People record yet.
    if (method === "POST" && pathname === "/api/join/register") {
      const email = await requireVerifiedEmail(request, env);
      const body = ((await readJsonBody(request)) ?? {}) as Record<string, unknown>;
      return json(await registerInterest(env, email, body), 200, origin);
    }
    if (pathname.startsWith("/api/trials/")) {
      const user = await requireAuthorizedUser(request, env);
      if (method === "GET" && pathname === "/api/trials/me") return json(await getMyTrial(env, user), 200, origin);
      if (method === "GET" && pathname === "/api/trials/sessions") return json(await listSessions(env, user), 200, origin);
      const session = pathname.match(/^\/api\/trials\/sessions\/([0-9a-f-]{36})\/remove$/);
      if (method === "POST" && session) return json(await removeSession(env, user, session[1]), 200, origin);
      if (method === "POST") {
        const body = ((await readJsonBody(request)) ?? {}) as Record<string, unknown>;
        if (pathname === "/api/trials/me") return json(await saveMyTrial(env, user, body), 200, origin);
        if (pathname === "/api/trials/submit") return json(await submitRegistration(env, user), 200, origin);
        if (pathname === "/api/trials/sessions") return json(await addSession(env, user, body), 200, origin);
      }
    }

    // ── Special events (Supabase; events.ts) ──────────────────────────────
    if (pathname.startsWith("/api/events")) {
      const user = await requireAuthorizedUser(request, env);
      const q = url.searchParams.get("q") ?? "";
      if (method === "GET" && pathname === "/api/events/mine") return json(await getMyEvents(env, user), 200, origin);
      if (method === "GET" && pathname === "/api/events/manage") return json(await getManageView(env, user), 200, origin);
      if (method === "GET" && pathname === "/api/events/find-people") return json(await findPeople(env, user, q), 200, origin);
      const ev = pathname.match(/^\/api\/events\/([0-9a-f-]{36})\/(respond|people|responses|status|poster|delete|charges|charges-sent|payment-proof|confirm-payment|waive|attendance|tick-everyone|register-taken|checkin|checkin-link)$/);
      if (method === "GET" && ev?.[2] === "people") return json(await searchEventPeople(env, user, ev[1], q), 200, origin);
      if (method === "GET" && ev?.[2] === "responses") return json(await getEventResponses(env, user, ev[1]), 200, origin);
      if (method === "GET" && ev?.[2] === "charges") return json(await getCharges(env, user, ev[1]), 200, origin);
      if (method === "GET" && ev?.[2] === "checkin") return json(await getCheckIn(env, user, ev[1], url.searchParams.get("c") ?? ""), 200, origin);
      if (method === "GET" && ev?.[2] === "checkin-link") return json(await checkinLink(env, user, ev[1]), 200, origin);
      if (method === "POST") {
        const body = ((await readJsonBody(request)) ?? {}) as Record<string, unknown>;
        if (pathname === "/api/events") return json(await saveEvent(env, user, body), 200, origin);
        if (pathname === "/api/events/audience") return json(await countAudience(env, user, body), 200, origin);
        if (pathname === "/api/events/social-secretaries") return json(await setSocialSecretaries(env, user, body), 200, origin);
        if (ev?.[2] === "respond") return json(await respondToEvent(env, user, ev[1], body), 200, origin);
        if (ev?.[2] === "status") return json(await setEventStatus(env, user, ev[1], body), 200, origin);
        if (ev?.[2] === "poster") return json(await uploadPoster(env, user, ev[1], body), 200, origin);
        if (ev?.[2] === "delete") return json(await deleteEvent(env, user, ev[1]), 200, origin);
        if (ev?.[2] === "charges-sent") return json(await markChargesSent(env, user, ev[1]), 200, origin);
        if (ev?.[2] === "payment-proof") return json(await uploadPaymentProof(env, user, ev[1], body), 200, origin);
        if (ev?.[2] === "confirm-payment") return json(await confirmPayment(env, user, ev[1], body), 200, origin);
        if (ev?.[2] === "waive") return json(await waiveCharge(env, user, ev[1], body), 200, origin);
        if (ev?.[2] === "attendance") return json(await setAttendance(env, user, ev[1], body), 200, origin);
        if (ev?.[2] === "tick-everyone") return json(await tickEveryone(env, user, ev[1]), 200, origin);
        if (ev?.[2] === "register-taken") return json(await setRegisterTaken(env, user, ev[1], body), 200, origin);
        if (ev?.[2] === "checkin") return json(await checkIn(env, user, ev[1], body), 200, origin);
      }
    }

    // ── Signing new members' applications (Supabase; applicationSigning.ts) ──
    const signing = pathname.match(/^\/api\/applications\/([A-Za-z0-9-]{3,40})\/(sign|drafts|pdf|send)$/);
    if (signing) {
      const user = await requireAuthorizedUser(request, env);
      if (method === "GET" && signing[2] === "sign") return json(await getSigningView(env, user, signing[1]), 200, origin);
      if (method === "POST" && signing[2] === "drafts") return json(await draftSponsorAnswers(env, user, signing[1]), 200, origin);
      if (method === "POST" && signing[2] === "sign") {
        const body = ((await readJsonBody(request)) ?? {}) as Record<string, unknown>;
        return json(await signApplication(env, user, signing[1], body), 200, origin);
      }
      if (method === "POST" && signing[2] === "pdf") return json(await remakeApplicationPdf(env, user, signing[1]), 200, origin);
      if (method === "POST" && signing[2] === "send") {
        const body = ((await readJsonBody(request)) ?? {}) as Record<string, unknown>;
        return json(await sendApplicationOn(env, user, signing[1], body), 200, origin);
      }
    }
    // Club documents behind sign-in (shared/application.ts CLUB_DOCS).
    const clubDoc = pathname.match(/^\/api\/club-docs\/([a-z-]+)$/);
    if (method === "GET" && clubDoc) {
      await requireAuthorizedUser(request, env);
      return await serveClubDoc(env, clubDoc[1], origin);
    }
    if (pathname.startsWith("/api/joiner-tasks/")) {
      const user = await requireAuthorizedUser(request, env);
      const task = pathname.match(/^\/api\/joiner-tasks\/([0-9a-f-]{36})(\/done)?$/);
      if (task && method === "GET" && !task[2]) return json(await getJoinerTask(env, user, task[1]), 200, origin);
      if (task && method === "POST" && task[2]) return json(await completeJoinerTask(env, user, task[1]), 200, origin);
    }

    // ── HKHA registration (Supabase backend; src/registration.ts) ─────────
    // HKID and passport numbers: the Hockey Convenor only.
    if (pathname.startsWith("/api/registration/")) {
      const user = await requireSection(request, env, "registration");
      if (method === "GET" && pathname === "/api/registration/board") return json(await getRegistrationBoard(env), 200, origin);
      if (method === "GET" && pathname === "/api/registration/export") {
        const opts = { todo: url.searchParams.get("todo") === "1", team: url.searchParams.get("team") || null };
        return json(await registrationCsv(env, user, opts), 200, origin);
      }
      if (method === "POST") {
        const body = ((await readJsonBody(request)) ?? {}) as Record<string, unknown>;
        if (pathname === "/api/registration/registered") return json(await markRegistered(env, user, body), 200, origin);
        if (pathname === "/api/registration/unregistered") return json(await unmarkRegistered(env, user, body), 200, origin);
      }
    }

    // ── Volunteering (Supabase backend; src/volunteering.ts) ──────────────
    if (method === "GET" && pathname === "/api/volunteering/me") {
      const user = await requireAuthorizedUser(request, env);
      return json(await getMyVolunteering(env, user), 200, origin);
    }
    if (method === "POST" && pathname === "/api/volunteering") {
      const user = await requireAuthorizedUser(request, env);
      const body = (await readJsonBody(request)) as Record<string, unknown>;
      return json(await saveVolunteering(env, user, body ?? {}), 200, origin);
    }
    if (method === "GET" && pathname === "/api/volunteering/board") {
      const user = await requireAuthorizedUser(request, env);
      return json(await getVolunteersBoard(env, user), 200, origin);
    }

    // ── Umpiring duties (Supabase backend; src/umpiring.ts) ───────────────
    // The club's umpires take duties; the Umpire Coordinator (and the
    // Section Captains) confirms, assigns, marks no-shows and reports.
    if (pathname.startsWith("/api/umpiring")) {
      const user = await requireAuthorizedUser(request, env);
      if (method === "GET" && pathname === "/api/umpiring") {
        return json(await getUmpiringBoard(env, user, url.searchParams.get("week")), 200, origin);
      }
      if (method === "GET" && pathname === "/api/umpiring/report") {
        return json(await getUmpiringReport(env, user, url.searchParams.get("season")), 200, origin);
      }
      const duty = pathname.match(/^\/api\/umpiring\/duties\/([0-9a-f-]{36})\/(take|assign)$/);
      if (duty && method === "POST") {
        const body = ((await readJsonBody(request)) ?? {}) as Record<string, unknown>;
        return json(duty[2] === "take" ? await takeDuty(env, user, duty[1], body) : await assignDuty(env, user, duty[1], body), 200, origin);
      }
      const entry = pathname.match(/^\/api\/umpiring\/assignments\/([0-9a-f-]{36})\/(withdraw|confirm|no-show)$/);
      if (entry && method === "POST") {
        if (entry[2] === "withdraw") return json(await withdrawAssignment(env, user, entry[1]), 200, origin);
        if (entry[2] === "confirm") return json(await confirmAssignment(env, user, entry[1]), 200, origin);
        const body = ((await readJsonBody(request)) ?? {}) as Record<string, unknown>;
        return json(await setNoShow(env, user, entry[1], body), 200, origin);
      }
    }

    // ── Kit (Supabase backend; src/kit.ts) ────────────────────────────────
    // Anyone signed in sees their own kit and hands on what they hold; the
    // board, spares and orders are the kit section's (Kit Convenor, Section
    // Captains).
    if (method === "GET" && pathname === "/api/kit/me") {
      const user = await requireAuthorizedUser(request, env);
      return json(await getMyKit(env, user), 200, origin);
    }
    if (method === "POST" && pathname === "/api/kit/move") {
      const user = await requireAuthorizedUser(request, env);
      const body = (await readJsonBody(request)) as Record<string, unknown>;
      return json(await moveKit(env, user, body ?? {}), 200, origin);
    }
    if (method === "POST" && pathname === "/api/kit/confirm") {
      const user = await requireAuthorizedUser(request, env);
      const body = (await readJsonBody(request)) as Record<string, unknown>;
      return json(await confirmKit(env, user, body ?? {}), 200, origin);
    }
    if (pathname.startsWith("/api/kit/")) {
      const user = await requireSection(request, env, "kit");
      if (method === "GET" && pathname === "/api/kit/board") {
        return json(await getKitBoard(env, url.searchParams.get("order")), 200, origin);
      }
      if (method === "GET" && pathname === "/api/kit/top-up") {
        return json(await topUpCsv(env, url.searchParams.get("order")), 200, origin);
      }
      const setMatch = pathname.match(/^\/api\/kit\/sets\/([^/]+)\/(history|sizes)$/);
      if (method === "GET" && setMatch?.[2] === "history") return json(await getSetHistory(env, setMatch[1]), 200, origin);
      if (method === "POST") {
        const body = ((await readJsonBody(request)) ?? {}) as Record<string, unknown>;
        if (setMatch?.[2] === "sizes") return json(await editSizes(env, user, setMatch[1], body), 200, origin);
        if (pathname === "/api/kit/allocate") return json(await allocateSpare(env, user, body), 200, origin);
        if (pathname === "/api/kit/release") return json(await releaseSet(env, user, body), 200, origin);
        if (pathname === "/api/kit/swap") return json(await swapItem(env, user, body), 200, origin);
        if (pathname === "/api/kit/new-number") return json(await giveNewNumber(env, user, body), 200, origin);
        const orderMatch = pathname.match(/^\/api\/kit\/orders\/([^/]+)\/(received|expected)$/);
        if (orderMatch?.[2] === "received") return json(await setOrderReceived(env, orderMatch[1], body), 200, origin);
        if (orderMatch?.[2] === "expected") return json(await setOrderExpected(env, orderMatch[1], body), 200, origin);
      }
    }

    // ── Commitment reviews (Supabase backend; src/reviews.ts) ─────────────
    // Signed-in only: who may see or submit each review is decided per
    // review (the member, their sponsor, Membership Officers).
    const reviewMatch = pathname.match(/^\/api\/reviews\/([^/]+)(?:\/(member|sponsor|officer))?$/);
    if (reviewMatch) {
      const [, reviewId, step] = reviewMatch;
      const user = await requireAuthorizedUser(request, env);
      if (method === "GET" && !step) return json(await getReview(env, user, reviewId), 200, origin);
      if (method === "POST" && step) {
        const body = (await readJsonBody(request)) as Record<string, unknown>;
        const submit = step === "member" ? submitMemberReport : step === "sponsor" ? submitSponsorReview : submitOfficerReview;
        return json(await submit(env, user, reviewId, body ?? {}), 200, origin);
      }
    }

    // ── Chairman's section (Section Chairs + Section Captains table) ──────
    // The directory carries every member's email address, so it is gated on
    // the section like the membership routes.
    if (method === "GET" && pathname === "/api/chairman/directory") {
      await requireSection(request, env, "chairman");
      return json(await getChairmanDirectory(env), 200, origin);
    }
    if (method === "POST" && pathname === "/api/chairman/export-log") {
      const user = await requireSection(request, env, "chairman");
      const body = (await readJsonBody(request)) as Partial<EmailExportInput>;
      return json(
        await logEmailExport(env, user, {
          kind: body.kind as EmailExportInput["kind"],
          people: Number(body.people),
          addresses: Number(body.addresses),
          description: String(body.description ?? ""),
        }),
        200,
        origin,
      );
    }

    // ── Calendar (Link generation uses email param, Feeds are public signed URLs) ──
    if (method === "GET" && pathname === "/api/calendar/link") {
      const user = await requireAuthorizedUser(request, env);
      return json(await handleGetCalendarLink(env, user.email, url.origin), 200, origin);
    }
    if (method === "GET" && pathname === "/api/calendar/feed.ics") {
      return handlePlayerCalendarFeed(env, url.searchParams.get("id"), url.searchParams.get("sig"));
    }
    if (method === "GET" && pathname === "/api/calendar/team-link") {
      const user = await requireAuthorizedUser(request, env);
      const team = requireParam(url.searchParams.get("team"), "team");
      return json(await handleGetTeamCalendarLink(env, user, team, url.origin), 200, origin);
    }
    if (method === "GET" && pathname === "/api/calendar/team-feed.ics") {
      return handleTeamCalendarFeed(env, url.searchParams.get("team"), url.searchParams.get("sig"));
    }

    return errorJson("Not Found", 404, origin, "NOT_FOUND");
  } catch (err) {
    if (err instanceof HttpError) return errorJson(err.message, err.status, origin, err.code);
    if (err instanceof AirtableError) {
      // Never return the Airtable URL, base id or response body to the
      // client - only the detail goes to Workers Logs.
      console.error("Airtable error:", err.message);
      return errorJson("Upstream data service error", 502, origin, "UPSTREAM_ERROR");
    }
    if (err instanceof SupabaseError) {
      // Which table, status and code - enough to diagnose from the screen,
      // never the database's message, which can quote a value.
      console.error("Supabase error:", err.message);
      const table = /^Supabase \w+ (\S+) failed/.exec(err.message)?.[1] ?? "?";
      return errorJson(`Database error (${table}, ${err.status}${err.code ? ` ${err.code}` : ""}). Please try again.`, 502, origin, "DB_ERROR");
    }

    console.error("Unhandled worker error:", err instanceof Error ? err.stack : err);
    return errorJson("Internal Server Error", 500, origin);
  }
}