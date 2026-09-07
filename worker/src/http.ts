// Shared response/CORS/error helpers so every route returns JSON
// consistently instead of ad-hoc Response objects.

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "BAD_REQUEST") {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

/**
 * ALLOWED_ORIGIN holds either one origin or a comma-separated allow-list, so
 * the API can serve the app on more than one hostname at once - needed while
 * a domain move is in flight and the old and new frontends are both live.
 */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * Picks the single origin to put in Access-Control-Allow-Origin.
 *
 * The request's own Origin is echoed back only when it is on the allow-list.
 * Anything else falls back to the first configured origin, so the header is
 * always one concrete origin - never a wildcard, and never the raw
 * comma-separated list, which browsers reject. Responses carry Vary: Origin
 * so a cache cannot serve one origin's header to another.
 */
export function resolveOrigin(request: Request, raw: string | undefined): string {
  const allowed = parseAllowedOrigins(raw);
  const requestOrigin = request.headers.get("Origin");
  if (requestOrigin && allowed.includes(requestOrigin)) return requestOrigin;
  return allowed[0] ?? "";
}

export function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function json(data: unknown, status = 200, origin: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}

/**
 * Error responses carry a stable machine-readable `error` code plus a
 * human-readable `message`, so the frontend can tell apart:
 *  - UNAUTHORIZED               -> 401, sign out
 *  - APPLICATION_ACCESS_DENIED  -> 403, sign out
 *  - COACH_ACCESS_REQUIRED      -> 403, stay logged in
 */
export function errorJson(
  message: string,
  status = 500,
  origin: string,
  code = "INTERNAL_ERROR"
): Response {
  return json({ error: code, message }, status, origin);
}

export function handleOptions(origin: string): Response {
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export function requireParam(value: string | null, name: string): string {
  if (!value) throw new HttpError(`Missing required query param: ${name}`, 400);
  return value;
}
