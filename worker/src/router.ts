/**
 * The Worker's router. Every route is one entry in a table (routes.ts, with
 * the officers' admin screens in admin/routes.ts): a method, a path, a guard
 * and a handler. dispatch() takes the first entry whose method and path
 * match, applies its guard, then calls its handler with what the guard gave.
 *
 * Paths are exact strings, or patterns with named parameters: ":id" is one
 * path segment, ":id([0-9a-f-]{36})" one that must also match the regex in
 * brackets. A parameter is handed over as the client sent it, never decoded.
 * Every pattern is compiled once, when the table is built at module load.
 *
 * A handler returns a Response, or anything else, which goes out as JSON
 * with status 200.
 */
import type { Env } from "./env";
import { HttpError, errorJson, json } from "./http";
import {
  requireAuthorizedUser,
  requireCoach,
  requireSection,
  requireSectionCaptain,
  requireVerifiedEmail,
  SECTION_OFFICES,
  type AuthorizedUser,
  type Section,
} from "./auth";
import { requireCoachOfMatch } from "./coachAccess";

export type Method = "GET" | "POST";

/**
 * Who may call a route, checked before its handler runs:
 *
 *   public          anyone (/health)
 *   signed-file     anyone; the handler checks the link's signature (files.ts)
 *   calendar-hmac   anyone; the handler checks the feed's HMAC (calendar.ts)
 *   verified-email  a Supabase session, without a People record (registering
 *                   to join, asking to be reactivated)
 *   signed-in       a person allowed into the app (auth.ts requireAuthorizedUser);
 *                   many modules then decide per record who may do what
 *   self-or-coach   signed in, and the :id in the path is the caller's own
 *                   record, unless they are a coach
 *   coach           a coach (auth.ts requireCoach)
 *   coach-of-match  a coach of either HKFC side of the :id match (coachAccess.ts)
 *   section-captain a Section Captain (auth.ts requireSectionCaptain)
 *   section:<name>  an officer whose office opens that section (auth.ts SECTION_OFFICES)
 */
export type Guard =
  | "public"
  | "signed-file"
  | "calendar-hmac"
  | "verified-email"
  | "signed-in"
  | "self-or-coach"
  | "coach"
  | "coach-of-match"
  | "section-captain"
  | `section:${Section}`;

export const GUARDS: readonly Guard[] = [
  "public",
  "signed-file",
  "calendar-hmac",
  "verified-email",
  "signed-in",
  "self-or-coach",
  "coach",
  "coach-of-match",
  "section-captain",
  ...(Object.keys(SECTION_OFFICES) as Section[]).map((s) => `section:${s}` as const),
];

/**
 * A coach check the handler makes itself, after the guard, because what it
 * checks is in the request body or the player record:
 *
 *   coach-of-match-side  the match and side the write goes to are the coach's (coachAccess.ts)
 *   coach-of-team        the team named is one the coach coaches
 *   coach-of-player      only players of the coach's own teams are changed
 */
export type AlsoChecks = "coach-of-match-side" | "coach-of-team" | "coach-of-player";

/** What a guard hands the handler. */
type Given<G extends Guard> = G extends "public" | "signed-file" | "calendar-hmac"
  ? object
  : G extends "verified-email"
  ? { email: string }
  : { user: AuthorizedUser };

export interface RouteContext {
  request: Request;
  env: Env;
  url: URL;
  /** The CORS origin for the response (http.ts resolveOrigin). */
  origin: string;
  /** The path's named parameters, as sent. */
  params: Record<string, string>;
}

type AnyHandler = (c: RouteContext & { user?: AuthorizedUser; email?: string }) => unknown;

export interface Route {
  method: Method;
  path: string;
  guard: Guard;
  also?: AlsoChecks;
  handler: AnyHandler;
  match: PathMatcher;
}

/** A path under a scope answers its guard's 401 / 403 before the 404 (see GUARDED_SCOPES in routes.ts). */
export interface Scope {
  path: string;
  guard: Guard;
  /** A POST reads its body first, so a body that isn't JSON is a 400. */
  postBody: boolean;
  match: PathMatcher;
}

type PathMatcher = (pathname: string) => Record<string, string> | null;

const NO_PARAMS: Record<string, string> = Object.freeze({}) as Record<string, string>;
const PARAM = /:(\w+)(?:\(([^)]*)\))?/g;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A matcher for an exact path, a pattern, or (scopes only) a prefix ending in "*". */
function compilePath(path: string): PathMatcher {
  if (!path.includes(":") && !path.endsWith("*")) return (pathname) => (pathname === path ? NO_PARAMS : null);
  let source = "^";
  let last = 0;
  for (const m of path.matchAll(PARAM)) {
    source += escapeRegex(path.slice(last, m.index)) + `(?<${m[1]}>${m[2] ?? "[^/]+"})`;
    last = m.index! + m[0].length;
  }
  const rest = path.slice(last);
  source += rest.endsWith("*") ? escapeRegex(rest.slice(0, -1)) : escapeRegex(rest) + "$";
  const re = new RegExp(source);
  return (pathname) => {
    const m = re.exec(pathname);
    return m ? { ...m.groups } : null;
  };
}

/** One table entry. */
export function route<G extends Guard>(
  method: Method,
  path: string,
  guard: G,
  handler: (c: RouteContext & Given<G>) => unknown,
  also?: AlsoChecks,
): Route {
  if (path.includes("*")) throw new Error(`A route's path cannot be a prefix: ${path}`);
  return { method, path, guard, ...(also ? { also } : {}), handler: handler as AnyHandler, match: compilePath(path) };
}

/** One scope entry: an exact path, a pattern, or a prefix ending in "*". */
export function scope(path: string, guard: Guard, opts: { postBody?: boolean } = {}): Scope {
  return { path, guard, postBody: opts.postBody === true, match: compilePath(path) };
}

/** Throws the guard's 401 / 403; answers what the handler is given. */
async function applyGuard(
  guard: Guard,
  request: Request,
  env: Env,
  params: Record<string, string>,
): Promise<{ user?: AuthorizedUser; email?: string }> {
  switch (guard) {
    case "public":
    case "signed-file":
    case "calendar-hmac":
      return {};
    case "verified-email":
      return { email: await requireVerifiedEmail(request, env) };
    case "signed-in":
      return { user: await requireAuthorizedUser(request, env) };
    case "self-or-coach": {
      const user = await requireAuthorizedUser(request, env);
      if (user.role !== "coach" && user.personId !== params.id) {
        throw new HttpError("Coach access required.", 403, "COACH_ACCESS_REQUIRED");
      }
      return { user };
    }
    case "coach":
      return { user: await requireCoach(request, env) };
    case "coach-of-match": {
      const user = await requireCoach(request, env);
      await requireCoachOfMatch(env, user, params.id);
      return { user };
    }
    case "section-captain":
      return { user: await requireSectionCaptain(request, env) };
    default:
      return { user: await requireSection(request, env, guard.slice("section:".length) as Section) };
  }
}

export async function readJsonBody(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    throw new HttpError("Request body must be valid JSON", 400);
  }
}

/** The JSON body, {} when it is null. */
export async function readBodyOrEmpty(request: Request): Promise<Record<string, unknown>> {
  return ((await readJsonBody(request)) ?? {}) as Record<string, unknown>;
}

/**
 * The first route matching the method and path, guarded; otherwise the
 * first scope covering the path, guarded, then 404 NOT_FOUND. There is no
 * 405: a known path with the wrong method is a 404 too.
 */
export async function dispatch(
  routes: readonly Route[],
  scopes: readonly Scope[],
  request: Request,
  env: Env,
  url: URL,
  origin: string,
): Promise<Response> {
  const method = request.method;
  const { pathname } = url;
  for (const r of routes) {
    if (r.method !== method) continue;
    const params = r.match(pathname);
    if (!params) continue;
    const given = await applyGuard(r.guard, request, env, params);
    const out = await r.handler({ request, env, url, origin, params, ...given });
    return out instanceof Response ? out : json(out, 200, origin);
  }
  for (const s of scopes) {
    const params = s.match(pathname);
    if (!params) continue;
    await applyGuard(s.guard, request, env, params);
    if (s.postBody && method === "POST") await readJsonBody(request);
    break;
  }
  return errorJson("Not Found", 404, origin, "NOT_FOUND");
}
