/**
 * Routes for the officers' admin screens (Supabase backend):
 *
 *   GET  /api/history?person=<api id>         people section
 *   GET  /api/admin/people?q=<name>           people section
 *   GET  /api/admin/people/:id                people section
 *
 * Each route checks its own section; the person page then shows only the
 * blocks the caller's offices open (people.ts canFor), and each save checks
 * again. Answers undefined for a path that isn't one of these.
 */
import type { Env } from "../env";
import { requireSection } from "../auth";
import { HttpError } from "../http";
import { getPersonAdmin, getPersonHistory, searchPeople } from "./people";

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
    await requireSection(request, env, "people");
    return getPersonHistory(env, url.searchParams.get("person") ?? "");
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
  return undefined;
}
