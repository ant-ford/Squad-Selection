import { getActivePlayers } from "./players";

export interface Env {
  AIRTABLE_TOKEN: string;
  AIRTABLE_BASE_ID: string;
}

export default {
  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {

    const url = new URL(request.url);

    if (
      request.method === "GET" &&
      url.pathname === "/api/players/active"
    ) {
      const players =
        await getActivePlayers(env);

      return Response.json(players);
    }

    return new Response(
      "Not Found",
      { status: 404 }
    );
  }
};