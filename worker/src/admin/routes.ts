/**
 * Routes for the officers' admin screens (Supabase backend):
 *
 *   GET  /api/history?person=<api id>         people section, or the person's coaches (history.ts)
 *   GET  /api/history?match=<api id>          people section, or the fixture's coaches
 *   GET  /api/admin/people?q=<name>           people section
 *   GET  /api/admin/people/:id                people section
 *   POST /api/admin/people/:id/membership     membership section
 *   POST /api/admin/people/:id/stage          membership section
 *   POST /api/admin/people/:id/squad          registered team: registration section;
 *                                             selected teams, position: club or registration
 *   GET  /api/admin/offices, /api/admin/teams club section (Section Captains)
 *   POST /api/admin/offices, /offices/:id     club section
 *   POST /api/admin/people                    club section (a new office holder)
 *   POST /api/admin/teams/:id                 club section
 *
 * Each route checks its own section; the person page then shows only the
 * blocks the caller's offices open (people.ts canFor), and each save checks
 * again. A part of the Worker's one route table (routes.ts).
 */
import { route, type Route } from "../router";
import { HttpError } from "../http";
import { getPersonAdmin, getPersonHistory, searchPeople } from "./people";
import { getMatchHistory } from "../history";
import { moveStage, saveMembership } from "./membership";
import { saveSquad } from "./squad";
import { addOffice, createOfficeHolder, editOffice, listOffices, listTeams, saveTeam } from "./club";

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError("Request body must be valid JSON", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError("Request body must be an object", 400);
  return body as Record<string, unknown>;
}

const ID = "[A-Za-z0-9-]{3,64}";

export const ADMIN_ROUTES: readonly Route[] = [
  // Officers and coaches: each reader checks which of them may see it.
  route("GET", "/api/history", "signed-in", ({ env, user, url }) => {
    const match = url.searchParams.get("match");
    if (match !== null) return getMatchHistory(env, user, match);
    return getPersonHistory(env, url.searchParams.get("person") ?? "", user);
  }),
  route("GET", "/api/admin/people", "section:people", async ({ env, url }) => ({ people: await searchPeople(env, url.searchParams.get("q") ?? "") })),
  route("GET", `/api/admin/people/:id(${ID})`, "section:people", ({ env, user, params }) => getPersonAdmin(env, user, params.id)),
  // Teams and position: the section check is per field (squad.ts).
  route("POST", `/api/admin/people/:id(${ID})/squad`, "section:people", async ({ request, env, user, params }) => saveSquad(env, user, params.id, await readBody(request))),
  route("POST", `/api/admin/people/:id(${ID})/membership`, "section:membership", async ({ request, env, user, params }) => saveMembership(env, user, params.id, await readBody(request))),
  route("POST", `/api/admin/people/:id(${ID})/stage`, "section:membership", async ({ request, env, user, params }) => moveStage(env, user, params.id, await readBody(request))),

  // Offices and teams: Section Captains.
  route("GET", "/api/admin/offices", "section:club", ({ env }) => listOffices(env)),
  route("GET", "/api/admin/teams", "section:club", ({ env }) => listTeams(env)),
  route("POST", "/api/admin/offices", "section:club", async ({ request, env, user }) => addOffice(env, user, await readBody(request))),
  route("POST", "/api/admin/people", "section:club", async ({ request, env, user }) => createOfficeHolder(env, user, await readBody(request))),
  route("POST", `/api/admin/offices/:id(${ID})`, "section:club", async ({ request, env, user, params }) => editOffice(env, user, params.id, await readBody(request))),
  route("POST", `/api/admin/teams/:id(${ID})`, "section:club", async ({ request, env, user, params }) => saveTeam(env, user, params.id, await readBody(request))),
];
