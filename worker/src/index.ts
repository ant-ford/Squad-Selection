import { Env, AirtableError } from "./airtable";
import { json, errorJson, handleOptions, requireParam, HttpError } from "./http";
import { requireAuthenticatedEmail, requireAuthorizedUser, requireCoach } from "./auth";
import { snapshotAirtableCalls, logRequestPerf } from "./perf";
import { getReferenceData, getActivePlayers, getPlayerByEmail } from "./reference";
import { getMyProfile } from "./profile";
import { getMyFixtures, getPlayerFixtures, getUpcomingFixtures } from "./fixtures";
import {
  getPlayersForMatch,
  getSquadForMatch,
  selectPlayer,
  removeSelection,
  getAvailabilityForMatch,
  syncSquad,
  setMatchKit,
  toggleAutoSelect,
  getTeamAutoSelectPlayers,
  setTeamAutoSelectPlayers,
} from "./squad";
import { setAvailability, setMyAvailability, setMyAvailabilityForDate } from "./availability";
import { createAvailabilityRule, deleteAvailabilityRule, getRulesForPlayer } from "./availabilityRules";
import { getRecommendationsForMatch } from "./recommendations";
import {
  handleGetCalendarLink,
  handlePlayerCalendarFeed,
  handleTeamCalendarExport,
  handleGetTeamCalendarLink,
  handleTeamCalendarFeed,
} from "./calendar";
import {
  getActiveRanking,
  getInactiveRanking,
  getAbilityGroupConfig,
  setAbilityGroupConfig,
  movePlayerToRank,
  movePlayerRelative,
  reorderRanking,
  activatePlayer,
  deactivatePlayer,
  initializeRanking,
} from "./ranking";
import { getEligibilityMetrics, resetEligibilityMetrics } from "./metrics";
import type { AbilityGroupConfigMap } from "../../src/generated/domainTypes";
import { getPlayUpWatch, getRecentAvailability, getRecentChanges } from "./dashboard";
import { getPlayerSeasonStats } from "./playerStats";
import { reconcileRegistrations } from "./registration";
import { selectedDisplayTeam } from "../../src/lib/displayTeam";
import type { Player } from "../../src/generated/domainTypes";

export type { Env };

async function readJsonBody(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    throw new HttpError("Request body must be valid JSON", 400);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const startedAt = Date.now();
    const atBefore = snapshotAirtableCalls();
    const url = new URL(request.url);

    let response: Response;
    try {
      response = await handleRequest(request, env);
    } catch (err) {
      console.error("Unhandled worker error:", err instanceof Error ? err.stack : err);
      response = errorJson("Internal Server Error", 500, env.ALLOWED_ORIGIN);
    }

    logRequestPerf({
      method: request.method,
      path: url.pathname,
      status: response.status,
      totalMs: Date.now() - startedAt,
      airtableCalls: snapshotAirtableCalls() - atBefore,
    });
    return response;
  },

  /**
   * Scheduled reconciliation (worker/wrangler.toml [triggers] cron).
   *
   * Cadence: daily at 02:00 Asia/Hong_Kong (18:00 UTC).
   * Runs in apply mode ONLY when the AUTO_REGISTRATION_ENABLED Worker var is
   * "true"; otherwise it logs a dry-run report and performs no writes, so
   * deploying this cron never silently enables production writes.
   * A failed scan is logged (Workers Logs) and never thrown - the next scan
   * is idempotent and self-heals partial runs.
   */
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const mode = env.AUTO_REGISTRATION_ENABLED === "true" ? "apply" : "dry-run";
    try {
      const report = await reconcileRegistrations(env, { mode });
      for (const result of report.results ?? []) {
        console.log(`[Registration] scheduled result: ${JSON.stringify(result)}`);
      }
      for (const diagnostic of report.diagnostics) {
        console.log(`[Registration] scheduled diagnostic: ${JSON.stringify(diagnostic)}`);
      }
    } catch (err) {
      console.error("[Registration] scheduled reconciliation failed:", err);
    }
  },
};

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const origin = env.ALLOWED_ORIGIN;
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  if (method === "OPTIONS") return handleOptions(origin);

  try {
      // ── Health Check (Public) ──────────────────────────────────────────────
      if (method === "GET" && pathname === "/health") {
        return json({ status: "ok", timestamp: new Date().toISOString() }, 200, origin);
      }

      // ── Eligibility Operational Metrics (Coach) ────────────────────────────
      if (method === "GET" && pathname === "/api/eligibility-metrics") {
        await requireCoach(request, env);
        return json(getEligibilityMetrics(), 200, origin);
      }
      if (method === "POST" && pathname === "/api/eligibility-metrics/reset") {
        await requireAuthenticatedEmail(request, env);
        resetEligibilityMetrics();
        return json({ success: true }, 200, origin);
      }

      // ── Match / Squad (Read - Authenticated) ───────────────────────────────
      // The squad list is player-facing: PlayerAvailabilitySheet shows a player
      // who else is in the squad before they set their own availability.
      const matchSquadMatch = pathname.match(/^\/api\/match\/([^/]+)\/squad$/);
      if (method === "GET" && matchSquadMatch) {
        await requireAuthorizedUser(request, env);
        return json(await getSquadForMatch(env, matchSquadMatch[1]), 200, origin);
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

      // ── Player / Fixtures (Read - Self or Coach) ───────────────────────────
      // The player id is client-supplied, so it is checked against the caller:
      // a player may only read their own fixtures, coaches may read anyone's.
      const playerFixturesMatch = pathname.match(/^\/api\/player-fixtures\/([^/]+)$/);
      if (method === "GET" && playerFixturesMatch) {
        const user = await requireAuthorizedUser(request, env);
        if (user.role !== "coach" && user.personId !== playerFixturesMatch[1]) {
          throw new HttpError("Coach access required.", 403, "COACH_ACCESS_REQUIRED");
        }
        return json(await getPlayerFixtures(env, playerFixturesMatch[1]), 200, origin);
      }

      // Display substitution at the response boundary: clients see the
      // Selected Team (EOS -> SOS -> Registered); the true Registered Team
      // stays server-side for all business rules (optics requirement).
      const displayPlayers = (players: Player[]) =>
        players.map((p) => ({ ...p, registeredTeam: selectedDisplayTeam(p) }));

      if (method === "GET" && pathname === "/api/players/active") {
        await requireAuthorizedUser(request, env);
        return json(displayPlayers(await getActivePlayers(env)), 200, origin);
      }

      if (method === "GET" && pathname === "/api/reference-data") {
        await requireAuthorizedUser(request, env);
        const ref = await getReferenceData(env);
        return json({ ...ref, players: displayPlayers(ref.players) }, 200, origin);
      }

      if (method === "GET" && pathname === "/api/player-by-email") {
        await requireCoach(request, env);
        const email = requireParam(url.searchParams.get("email"), "email");
        const player = await getPlayerByEmail(env, email);
        if (!player) throw new HttpError("Player record not found for this email", 404);
        return json({ ...player, registeredTeam: selectedDisplayTeam(player) }, 200, origin);
      }

      // Player-facing routes: identity always comes from the verified Supabase
      // session, never from client-supplied email query parameters.
      if (method === "GET" && pathname === "/api/my-profile") {
        const user = await requireAuthorizedUser(request, env);
        return json(await getMyProfile(env, user.email), 200, origin);
      }
      if (method === "GET" && pathname === "/api/my-fixtures") {
        const user = await requireAuthorizedUser(request, env);
        return json(await getMyFixtures(env, user.email), 200, origin);
      }
      if (method === "GET" && pathname === "/api/upcoming-fixtures") {
        const user = await requireAuthorizedUser(request, env);
        const team = url.searchParams.get("team") ?? undefined;
        return json(await getUpcomingFixtures(env, { email: user.email, team }), 200, origin);
      }

      // Dashboard metrics (Authenticated)
      if (method === "GET" && pathname === "/api/recent-changes") {
        await requireAuthorizedUser(request, env);
        const days = Number(url.searchParams.get("days") ?? 7);
        return json(
          await getRecentChanges(env, Number.isFinite(days) && days > 0 ? days : 7),
          200,
          origin,
        );
      }
      if (method === "GET" && pathname === "/api/playup-watch") {
        await requireAuthorizedUser(request, env);
        return json(await getPlayUpWatch(env), 200, origin);
      }
      if (method === "GET" && pathname === "/api/recent-availability") {
        await requireAuthorizedUser(request, env);
        const days = Number(url.searchParams.get("days") ?? 7);
        return json(
          await getRecentAvailability(env, Number.isFinite(days) ? days : 7),
          200,
          origin,
        );
      }

      // ── Selection Writes (Authenticated) ───────────────────────────────────
      if (method === "POST" && pathname === "/api/select-player") {
        await requireCoach(request, env);
        const body = await readJsonBody(request);
        return json(await selectPlayer(env, body), 200, origin);
      }
      if (method === "POST" && pathname === "/api/remove-selection") {
        await requireCoach(request, env);
        const body = (await readJsonBody(request)) as {
          matchId: string;
          playerId: string;
          side?: "home" | "away";
        };
        return json(await removeSelection(env, body), 200, origin);
      }
      if (method === "POST" && pathname === "/api/set-availability") {
        await requireCoach(request, env);
        const body = await readJsonBody(request);
        return json(await setAvailability(env, body), 200, origin);
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
          existingExceptionId?: string;
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
            existingExceptionId: body.existingExceptionId,
          }),
          200,
          origin,
        );
      }

      if (method === "POST" && pathname === "/squad/sync") {
        const user = await requireCoach(request, env);
        const body = (await readJsonBody(request)) as {
          matchId: string;
          selectedIds: string[];
          side?: "home" | "away";
        };
        await syncSquad(env, body.matchId, body.selectedIds, user.email, body.side);
        return json({ success: true }, 200, origin);
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
      if (method === "GET" && pathname === "/api/ranking/config") {
        await requireCoach(request, env);
        return json(await getAbilityGroupConfig(env), 200, origin);
      }

      if (method === "POST" && pathname === "/api/ranking/config") {
        const user = await requireCoach(request, env);
        const body = (await readJsonBody(request)) as { config: AbilityGroupConfigMap };
        const rankingList = await setAbilityGroupConfig(env, body.config, user.email);
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
      if (
        method === "POST" &&
        (pathname === "/api/ranking/initialize" || pathname === "/api/ranking/backfill")
      ) {
        await requireCoach(request, env);
        return json(await initializeRanking(env), 200, origin);
      }

      // ── Calendar (Link generation uses email param, Feeds are public signed URLs) ──
      if (method === "GET" && pathname === "/api/calendar/link") {
        const user = await requireAuthorizedUser(request, env);
        return json(await handleGetCalendarLink(env, user.email), 200, origin);
      }
      if (method === "GET" && pathname === "/api/calendar/feed.ics") {
        return handlePlayerCalendarFeed(env, url.searchParams.get("id"), url.searchParams.get("sig"));
      }
      if (method === "GET" && pathname === "/api/calendar/team.ics") {
        const user = await requireAuthorizedUser(request, env);
        return handleTeamCalendarExport(env, user.email, url.searchParams.get("team"));
      }
      if (method === "GET" && pathname === "/api/calendar/team-link") {
        const user = await requireAuthorizedUser(request, env);
        const team = requireParam(url.searchParams.get("team"), "team");
        return json(await handleGetTeamCalendarLink(env, user.email, team), 200, origin);
      }
      if (method === "GET" && pathname === "/api/calendar/team-feed.ics") {
        return handleTeamCalendarFeed(env, url.searchParams.get("team"), url.searchParams.get("sig"));
      }

      // Automatic re-registration reconciliation (coach / Section Captain
      // only). POST /api/registration/reconcile { "mode": "dry-run"|"apply" }.
      // Dry-run is the default. Apply mode performs real Airtable writes and
      // is additionally gated by the AUTO_REGISTRATION_ENABLED Worker var.
      // No client input can influence WHICH player or destination team is
      // written: the scan is computed entirely server-side from Match Cards.
      if (method === "POST" && pathname === "/api/registration/reconcile") {
        const user = await requireCoach(request, env);
        const body = (await request.json().catch(() => ({}))) as { mode?: string };
        const mode = body?.mode === "apply" ? "apply" : "dry-run";
        if (mode === "apply" && env.AUTO_REGISTRATION_ENABLED !== "true") {
          throw new HttpError(
            'Automatic re-registration writes are disabled. Set the AUTO_REGISTRATION_ENABLED Worker var to "true" to enable apply mode.',
            403,
            "AUTO_REGISTRATION_DISABLED",
          );
        }
        return json(await reconcileRegistrations(env, { mode }), 200, origin);
      }

      return errorJson("Not Found", 404, origin, "NOT_FOUND");
    } catch (err) {
      if (err instanceof HttpError) return errorJson(err.message, err.status, origin, err.code);
      if (err instanceof AirtableError)
        return errorJson(`Airtable: ${err.message}`, err.status >= 400 ? err.status : 502, origin);

      console.error("Unhandled worker error:", err instanceof Error ? err.stack : err);
      return errorJson("Internal Server Error", 500, origin);
    }
}