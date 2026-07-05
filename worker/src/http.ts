// Shared response/CORS/error helpers so every route returns JSON
// consistently instead of ad-hoc Response objects.

export class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function corsHeaders(origin?: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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

export function errorJson(message: string, status = 500, origin?: string): Response {
  return json({ error: message }, status, origin);
}

export function handleOptions(origin?: string): Response {
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export function requireParam(value: string | null, name: string): string {
  if (!value) throw new HttpError(`Missing required query param: ${name}`, 400);
  return value;
}
