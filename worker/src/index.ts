import { Env } from "./airtable";
import { json, errorJson, handleOptions, requireParam, HttpError } from "./http";
import { getReferenceData, getActivePlayers, getPlayerByEmail } from "./reference";
import { getMyProfile } from "./profile";
import { getMyFixtures, getPlayerFixtures, getUpcomingFixtures } from "./fixtures";
import {
  getPlayersForMatch,
  getSquadForMatch,
  selectPlayer,
  removeSelection,
  getAvailabilityForMatch,
  batchUpdateSquad
} from "./squad";
import { setAvailability, setMyAvailability } from "./availability";

export type { Env };

async function readJsonBody(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    throw new HttpError("Request body must be valid JSON", 400);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = env.ALLOWED_ORIGIN;
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    if (method === "OPTIONS") {
      return handleOptions(origin);
    }

    try {
      // ---------------------------------------------------------------
      // Match-based GET endpoints
      // ---------------------------------------------------------------

      const matchSquadMatch = pathname.match(/^\/api\/match\/([^/]+)\/squad$/);
      if (method === "GET" && matchSquadMatch) {
        return json(await getSquadForMatch(env, matchSquadMatch[1]), 200, origin);
      }

      const matchPlayersMatch = pathname.match(/^\/api\/match\/([^/]+)\/players$/);
      if (method === "GET" && matchPlayersMatch) {
        return json(await getPlayersForMatch(env, matchPlayersMatch[1]), 200, origin);
      }

      const matchAvailabilityMatch = pathname.match(/^\/api\/match\/([^/]+)\/availability$/);
      if (method === "GET" && matchAvailabilityMatch) {
        return json(await getAvailabilityForMatch(env, matchAvailabilityMatch[1]), 200, origin);
      }

      const matchBatchMatch = pathname.match(/^\/api\/match\/([^/]+)\/squad\/batch$/);
      if (method === "POST" && matchBatchMatch) {
        const body = await readJsonBody(request);
        return json(
          await batchUpdateSquad(env, matchBatchMatch[1], body.deltas, body.actingEmail),
          200,
          origin
        );
      }

      const playerFixturesMatch = pathname.match(/^\/api\/player-fixtures\/([^/]+)$/);
      if (method === "GET" && playerFixturesMatch) {
        return json(await getPlayerFixtures(env, playerFixturesMatch[1]), 200, origin);
      }

      // ---------------------------------------------------------------
      // Simple GET endpoints
      // ---------------------------------------------------------------

      if (method === "GET" && pathname === "/api/players/active") {
        return json(await getActivePlayers(env), 200, origin);
      }

      if (method === "GET" && pathname === "/api/reference-data") {
        return json(await getReferenceData(env), 200, origin);
      }

      if (method === "GET" && pathname === "/api/player-by-email") {
        const email = requireParam(url.searchParams.get("email"), "email");
        const player = await getPlayerByEmail(env, email);
        if (!player) throw new HttpError("Player record not found for this email", 404);
        return json(player, 200, origin);
      }

      if (method === "GET" && pathname === "/api/my-profile") {
        const email = url.searchParams.get("email");
        if (!email) return json({ error: "email is required" }, 400);
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

      // ---------------------------------------------------------------
      // Write endpoints
      // ---------------------------------------------------------------

      if (method === "POST" && pathname === "/api/select-player") {
        const body = await readJsonBody(request);
        return json(await selectPlayer(env, body), 200, origin);
      }

      if (method === "POST" && pathname === "/api/remove-selection") {
        const body = await readJsonBody(request);
        return json(await removeSelection(env, body.selectionId), 200, origin);
      }

      if (method === "POST" && pathname === "/api/set-availability") {
        const body = await readJsonBody(request);
        return json(await setAvailability(env, body), 200, origin);
      }

      if (method === "POST" && pathname === "/api/set-my-availability") {
        const body = await readJsonBody(request);
        return json(await setMyAvailability(env, body), 200, origin);
      }

      // ---------------------------------------------------------------
      // Fallback
      // ---------------------------------------------------------------

      return errorJson("Not Found", 404, origin);

    } catch (err) {
      if (err instanceof HttpError) {
        return errorJson(err.message, err.status, origin);
      }
      console.error("Unhandled worker error:", err);
      return errorJson("Internal Server Error", 500, origin);
    }
  },
};
