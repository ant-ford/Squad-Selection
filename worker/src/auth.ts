import { HttpError } from "./http";
import type { Env } from "./airtable";

/**
 * Verifies the caller's Supabase access token and returns the verified email.
 * This replaces all client-supplied `email` / `actingEmail` parameters.
 */
export async function requireAuthenticatedEmail(request: Request, env: Env): Promise<string> {
  const header = request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new HttpError("Missing Authorization header", 401);

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new HttpError("Server authentication not configured", 500);
  }

  const resp = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { 
      Authorization: `Bearer ${token}`, 
      apikey: env.SUPABASE_ANON_KEY 
    },
  });
  
  if (!resp.ok) {
    const detail = await resp.text();
    console.error("Supabase auth verification failed:", resp.status, detail);
    throw new HttpError("Invalid or expired session", 401);
  }

  const user = (await resp.json()) as { email?: string };
  if (!user.email) throw new HttpError("Session has no associated email", 401);
  return user.email;
}