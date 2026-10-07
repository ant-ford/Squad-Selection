/**
 * Routes for the officers' admin screens (Supabase backend):
 *
 *   GET  /api/history?person=<api id>         people section, or the person's coaches (history.ts)
 *   GET  /api/history?match=<api id>          people section, or the fixture's coaches
 *   GET  /api/admin/people?q=<name>           people section
 *   GET  /api/admin/people/:id                people section
 *   POST /api/admin/people/:id/membership     membership section
 *   POST /api/admin/people/:id/stage          membership section
 *   GET  /api/admin/offices, /api/admin/teams club section (Section Captains)
 *   POST /api/admin/offices, /offices/:id     club section
 *   POST /api/admin/people                    club section (a new office holder)
 *   POST /api/admin/teams/:id                 club section
 *
 * Each route checks its own section; the person page then shows only the
 * blocks the caller's offices open (people.ts canFor), and each save checks
 * again. Answers undefined for a path that isn't one of these.
 */
import type { Env } from "../env";
import { requireAuthorizedUser, requireSection } from "../auth";
import { HttpError } from "../http";
import { getPersonAdmin, getPersonHistory, searchPeople } from "./people";
import { getMatchHistory } from "../history";
import { moveStage, saveMembership } from "./membership";
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

export function isAdminPath(pathname: string): boolean {
  return pathname === "/api/history" || pathname.startsWith("/api/admin/");
}

export async function adminRoute(request: Request, env: Env, url: URL): Promise<unknown | undefined> {
  const { pathname } = url;
  const method = request.method;

  if (method === "GET" && pathname === "/api/history") {
    // Officers and coaches: each reader checks which of them may see it.
    const user = await requireAuthorizedUser(request, env);
    const match = url.searchParams.get("match");
    if (match !== null) return getMatchHistory(env, user, match);
    return getPersonHistory(env, url.searchParams.get("person") ?? "", user);
  }
  if (method === "GET" && pathname === "/api/admin/people") {
    await requireSection(request, env, "people");
    return { people: await searchPeople(env, url.searchParams.get("q") ?? "") };
  }
  const person = pathname.match(/^\/api\/admin\/people\/([A-Za-z0-9-]{3,64})$/);
  if (method === "GET" && person) {
    const user = await requireSection(request, env, "people");
    return getPersonAdmin(env, user, person[1]);
  }
  const membership = pathname.match(/^\/api\/admin\/people\/([A-Za-z0-9-]{3,64})\/(membership|stage)$/);
  if (method === "POST" && membership) {
    const user = await requireSection(request, env, "membership");
    const body = await readBody(request);
    return membership[2] === "membership" ? saveMembership(env, user, membership[1], body) : moveStage(env, user, membership[1], body);
  }

  // Offices and teams: Section Captains.
  const office = pathname.match(/^\/api\/admin\/offices\/([A-Za-z0-9-]{3,64})$/);
  const team = pathname.match(/^\/api\/admin\/teams\/([A-Za-z0-9-]{3,64})$/);
  const club =
    (method === "GET" && (pathname === "/api/admin/offices" || pathname === "/api/admin/teams")) ||
    (method === "POST" && (pathname === "/api/admin/offices" || pathname === "/api/admin/people" || !!office || !!team));
  if (club) {
    const user = await requireSection(request, env, "club");
    if (method === "GET") return pathname === "/api/admin/offices" ? listOffices(env) : listTeams(env);
    const body = await readBody(request);
    if (pathname === "/api/admin/offices") return addOffice(env, user, body);
    if (pathname === "/api/admin/people") return createOfficeHolder(env, user, body);
    if (office) return editOffice(env, user, office[1], body);
    return saveTeam(env, user, team![1], body);
  }
  return undefined;
}
