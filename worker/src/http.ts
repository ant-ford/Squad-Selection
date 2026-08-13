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

export function corsHeaders(origin?: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function json(data: unknown, status = 200, origin?: string): Response {
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
  origin?: string,
  code = "INTERNAL_ERROR"
): Response {
  return json({ error: code, message }, status, origin);
}

export function handleOptions(origin?: string): Response {
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export function requireParam(value: string | null, name: string): string {
  if (!value) throw new HttpError(`Missing required query param: ${name}`, 400);
  return value;
}
