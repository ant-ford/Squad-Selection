import { Env, AirtableError } from "./airtable";
import { json, errorJson, handleOptions, requireParam, HttpError } from "./http";
import { requireAuthenticatedEmail } from "./auth";
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
  toggleAutoSelect,
  getTeamAutoSelectPlayers,
  setTeamAutoSelectPlayers,
} from "./squad";
import { setAvailability, setMyAvailability } from "./availability";
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

      // ── Eligibility operational metrics ────────────────────────────────────
      if (method === "GET" && pathname === "/api/eligibility-metrics") {
        return json(getEligibilityMetrics(), 200, origin);
      }
      if (method === "POST" && pathname === "/api/eligibility-metrics/reset") {
        await requireAuthenticatedEmail(request, env);
        resetEligibilityMetrics();
        return json({ success: true }, 200, origin);
      }

      // ── Match / Squad (Read) ───────────────────────────────────────────────
      const matchSquadMatch = pathname.match(/^\/api\/match\/([^/]+)\/squad$/);
      if (method === "GET" && matchSquadMatch)
        return json(await getSquadForMatch(env, matchSquadMatch[1]), 200, origin);

      const matchPlayersMatch = pathname.match(/^\/api\/match\/([^/]+)\/players$/);
      if (method === "GET" && matchPlayersMatch) {
        const side = url.searchParams.get("side") as "home" | "away" | null;
        return json(
          await getPlayersForMatch(env, matchPlayersMatch[1], side ?? undefined),
          200,
          origin,
        );
      }

      const matchRecsMatch = pathname.match(/^\/api\/match\/([^/]+)\/recommendations$/);
      if (method === "GET" && matchRecsMatch) {
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
      if (method === "GET" && matchAvailabilityMatch)
        return json(await getAvailabilityForMatch(env, matchAvailabilityMatch[1]), 200, origin);

      // ── Auto-Select Toggle (Write - Authenticated) ─────────────────────────
      const autoSelectMatch = pathname.match(/^\/api\/match\/([^/]+)\/auto-select$/);
      if (method === "POST" && autoSelectMatch) {
        const actingEmail = await requireAuthenticatedEmail(request, env);
        const body = await readJsonBody(request);
        const enabled = body.enabled === true || body.enabled === 'true';
        if (typeof enabled !== 'boolean') throw new HttpError("enabled must be a boolean", 400);
        return json(
          await toggleAutoSelect(env, autoSelectMatch[1], enabled, actingEmail),
          200,
          origin,
        );
      }

      // ── Priority Player List (Read/Write - Authenticated) ──────────────────
      if (method === "GET" && pathname === "/api/team/auto-select-players") {
        await requireAuthenticatedEmail(request, env);
        const teamName = requireParam(url.searchParams.get("team"), "team");
        return json(await getTeamAutoSelectPlayers(env, teamName), 200, origin);
      }
      if (method === "POST" && pathname === "/api/team/auto-select-players") {
        const actingEmail = await requireAuthenticatedEmail(request, env);
        const body = await readJsonBody(request);
        const teamName = requireParam(body.teamName, "teamName");
        return json(
          await setTeamAutoSelectPlayers(env, teamName, body.playerIds || [], actingEmail),
          200,
          origin,
        );
      }

      // ── Player / Fixtures (Read) ───────────────────────────────────────────
      const playerFixturesMatch = pathname.match(/^\/api\/player-fixtures\/([^/]+)$/);
      if (method === "GET" && playerFixturesMatch)
        return json(await getPlayerFixtures(env, playerFixturesMatch[1]), 200, origin);

      if (method === "GET" && pathname === "/api/players/active") {
        await requireAuthenticatedEmail(request, env);
        return json(await getActivePlayers(env), 200, origin);
      }

      if (method === "GET" && pathname === "/api/reference-data") {
        await requireAuthenticatedEmail(request, env);
        return json(await getReferenceData(env), 200, origin);
      }

      if (method === "GET" && pathname === "/api/player-by-email") {
        await requireAuthenticatedEmail(request, env);
        const email = requireParam(url.searchParams.get("email"), "email");
        const player = await getPlayerByEmail(env, email);
        if (!player) throw new HttpError("Player record not found for this email", 404);
        return json(player, 200, origin);
      }

      // Player-facing routes (remain unauthenticated as they rely on email param / signed links per spec)
      if (method === "GET" && pathname === "/api/my-profile") {
        const email = requireParam(url.searchParams.get("email"), "email");
        return json(await getMyProfile(env, email));
      }
      if (method === "GET" && pathname === "/api/my-fixtures") {
        const email = requireParam(url.searchParams.get("email"), "email");
        return json(await getMyFixtures(env, email), 200, origin);
      }
      if (method === "GET" && pathname === "/api/upcoming-fixtures") {
        const email = url.searchParams.get("email") ?? undefined;
        const team = url.searchParams.get("team") ?? undefined;
        return json(await getUpcomingFixtures(env, { email, team }), 200, origin);
      }
      
      // Dashboard metrics (Authenticated)
      if (method === "GET" && pathname === "/api/recent-changes") {
        await requireAuthenticatedEmail(request, env);
        const days = Number(url.searchParams.get("days") ?? 7);
        return json(await getRecentChanges(env, Number.isFinite(days) && days > 0 ? days : 7), 200, origin);
      }
      if (method === "GET" && pathname === "/api/playup-watch") {
        await requireAuthenticatedEmail(request, env);
        return json(await getPlayUpWatch(env), 200, origin);
      }
      if (method === "GET" && pathname === "/api/recent-availability") {
        await requireAuthenticatedEmail(request, env);
        const days = Number(url.searchParams.get("days") ?? 7);
        return json(await getRecentAvailability(env, Number.isFinite(days) ? days : 7), 200, origin);
      }

      // ── Selection writes (Authenticated) ───────────────────────────────────
      if (method === "POST" && pathname === "/api/select-player") {
        await requireAuthenticatedEmail(request, env);
        const body = await readJsonBody(request);
        return json(await selectPlayer(env, body), 200, origin);
      }
      if (method === "POST" && pathname === "/api/remove-selection") {
        await requireAuthenticatedEmail(request, env);
        const body = (await readJsonBody(request)) as {
          matchId: string;
          playerId: string;
          side?: "home" | "away";
        };
        return json(await removeSelection(env, body), 200, origin);
      }
      if (method === "POST" && pathname === "/api/set-availability") {
        await requireAuthenticatedEmail(request, env);
        const body = await readJsonBody(request);
        return json(await setAvailability(env, body), 200, origin);
      }

      // Player self-service availability (Unauthenticated per spec)
      if (method === "POST" && pathname === "/api/set-my-availability") {
        const body = await readJsonBody(request);
        return json(await setMyAvailability(env, body), 200, origin);
      }

      if (method === "POST" && pathname === "/squad/sync") {
        const actingEmail = await requireAuthenticatedEmail(request, env);
        const body = (await readJsonBody(request)) as {
          matchId: string;
          selectedIds: string[];
          side?: "home" | "away";
        };
        await syncSquad(env, body.matchId, body.selectedIds, actingEmail, body.side);
        return json({ success: true }, 200, origin);
      }

      // ── Ranking ────────────────────────────────────────────────────────────
      if (method === "GET" && pathname === "/api/ranking")
        return json(await getActiveRanking(env), 200, origin);
      if (method === "GET" && pathname === "/api/ranking/inactive")
        return json(await getInactiveRanking(env), 200, origin);
      if (method === "GET" && pathname === "/api/ranking/config")
        return json(await getAbilityGroupConfig(env), 200, origin);

      if (method === "POST" && pathname === "/api/ranking/config") {
        const actingEmail = await requireAuthenticatedEmail(request, env);
        const body = (await readJsonBody(request)) as { config: AbilityGroupConfigMap };
        const rankingList = await setAbilityGroupConfig(env, body.config, actingEmail);
        return json(rankingList, 200, origin);
      }
      if (method === "POST" && pathname === "/api/ranking/move") {
        const actingEmail = await requireAuthenticatedEmail(request, env);
        const body = (await readJsonBody(request)) as { playerId: string; newRank: number };
        return json(await movePlayerToRank(env, body.playerId, body.newRank, actingEmail), 200, origin);
      }
      if (method === "POST" && pathname === "/api/ranking/move-relative") {
        const actingEmail = await requireAuthenticatedEmail(request, env);
        const body = (await readJsonBody(request)) as {
          sourceId: string;
          targetId: string;
          position: "above" | "below";
        };
        return json(
          await movePlayerRelative(env, body.sourceId, body.targetId, body.position, actingEmail),
          200,
          origin,
        );
      }
      if (method === "POST" && pathname === "/api/ranking/reorder") {
        const actingEmail = await requireAuthenticatedEmail(request, env);
        const body = (await readJsonBody(request)) as { playerIds: string[] };
        return json(await reorderRanking(env, body.playerIds, actingEmail), 200, origin);
      }
      if (method === "POST" && pathname === "/api/ranking/activate") {
        const actingEmail = await requireAuthenticatedEmail(request, env);
        const body = (await readJsonBody(request)) as { playerId: string };
        return json(await activatePlayer(env, body.playerId, actingEmail), 200, origin);
      }
      if (method === "POST" && pathname === "/api/ranking/deactivate") {
        const actingEmail = await requireAuthenticatedEmail(request, env);
        const body = (await readJsonBody(request)) as { playerId: string };
        return json(await deactivatePlayer(env, body.playerId, actingEmail), 200, origin);
      }
      if (method === "POST" && (pathname === "/api/ranking/initialize" || pathname === "/api/ranking/backfill")) {
        await requireAuthenticatedEmail(request, env);
        return json(await initializeRanking(env), 200, origin);
      }

      // ── Calendar (Link generation uses email param, Feeds are public signed URLs) ──
      if (method === "GET" && pathname === "/api/calendar/link") {
        const email = requireParam(url.searchParams.get("email"), "email");
        return json(await handleGetCalendarLink(env, email), 200, origin);
      }
      if (method === "GET" && pathname === "/api/calendar/feed.ics") {
        return handlePlayerCalendarFeed(env, url.searchParams.get("id"), url.searchParams.get("sig"));
      }
      if (method === "GET" && pathname === "/api/calendar/team.ics") {
        return handleTeamCalendarExport(env, url.searchParams.get("email"), url.searchParams.get("team"));
      }
      if (method === "GET" && pathname === "/api/calendar/team-link") {
        const email = requireParam(url.searchParams.get("email"), "email");
        const team = requireParam(url.searchParams.get("team"), "team");
        return json(await handleGetTeamCalendarLink(env, email, team), 200, origin);
      }
      if (method === "GET" && pathname === "/api/calendar/team-feed.ics") {
        return handleTeamCalendarFeed(env, url.searchParams.get("team"), url.searchParams.get("sig"));
      }

      return errorJson("Not Found", 404, origin);
    } catch (err) {
      if (err instanceof HttpError) return errorJson(err.message, err.status, origin);
      if (err instanceof AirtableError)
        return errorJson(`Airtable: ${err.message}`, err.status >= 400 ? err.status : 502, origin);
      console.error("Unhandled worker error:", err instanceof Error ? err.stack : err);
      return errorJson("Internal Server Error", 500, origin);
    }
  },
};