import { HttpError } from "./http";
import type { Env } from "./airtable";
import { getPlayerByEmail, getTeamCoachLinks } from "./reference";

/**
 * Normalizes an email for matching: trims surrounding whitespace and
 * lowercases. Supabase and Airtable stores can disagree on case, so every
 * lookup and comparison uses the normalized form.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Verifies the caller's Supabase access token and returns the verified,
 * normalized email. This replaces all client-supplied `email` /
 * `actingEmail` parameters.
 */
export async function requireAuthenticatedEmail(request: Request, env: Env): Promise<string> {
  const email = await verifySupabaseSession(request, env);
  return normalizeEmail(email);
}

export interface AuthorizedUser {
  /** Verified, normalized email from the Supabase session. */
  email: string;
  /** Matched People record id in Airtable. */
  personId: string;
  /** "coach" when the person holds any coach / section-captain relationship. */
  role: "player" | "coach";
}

/**
 * Full application authorization:
 *
 *   Supabase JWT -> verified email -> People record -> Teams links -> AuthorizedUser
 *
 * Access rules (People table is the source of truth):
 *  - the email must exist in People (case-insensitive, whitespace-normalized)
 *  - Active = true grants normal player access
 *  - coaches / section captains may be Active = false and are still allowed
 *  - the Teams table linked Coach / Section Captain fields are authoritative;
 *    People.Player/Coach is only a fallback data-quality safeguard
 */
export async function requireAuthorizedUser(request: Request, env: Env): Promise<AuthorizedUser> {
  const email = await verifySupabaseSession(request, env);
  const normalizedEmail = normalizeEmail(email);

  // Independent reads keyed off the verified session - run in parallel.
  // No behavioural or security impact: both are pure reads, neither depends
  // on the other's result, and a failure in either rejects the request
  // exactly as the sequential version did. The coach-link lookup warms its
  // 10-minute cache either way.
  const [player, links] = await Promise.all([
    getPlayerByEmail(env, normalizedEmail, { fresh: true }),
    getTeamCoachLinks(env),
  ]);
  const { coachIds, sectionCaptainIds } = links;

  if (!player) {
    throw new HttpError("Application access is not authorised.", 403, "APPLICATION_ACCESS_DENIED");
  }

  const isActive = player.active === true;

  // Teams table linked fields are the authoritative source for coach access.
  // Uses ALL team records (not just active ones) so a person's access never
  // depends on whether their team record is temporarily marked inactive.
  const isTeamCoach = coachIds.includes(player.id);
  const isSectionCaptain = sectionCaptainIds.includes(player.id);

  // Fallback / data-quality safeguard: People."Player/Coach" multi-select.
  const hasCoachFlag = (player.playerCoach ?? []).some(
    (c) => typeof c === "string" && c.toLowerCase().includes("coach"),
  );

  const isCoach = isTeamCoach || isSectionCaptain || hasCoachFlag;

  if (!isActive && !isCoach) {
    throw new HttpError("Your HKFC application access has been disabled.", 403, "APPLICATION_ACCESS_DENIED");
  }

  return {
    email: normalizedEmail,
    personId: player.id,
    role: isCoach ? "coach" : "player",
  };
}

/**
 * Coach-only gate for coach operations. A legitimate application user
 * without coach privileges gets 403 COACH_ACCESS_REQUIRED (the frontend
 * keeps them logged in) â€” distinct from application-access denial.
 */
export async function requireCoach(request: Request, env: Env): Promise<AuthorizedUser> {
  const user = await requireAuthorizedUser(request, env);
  if (user.role !== "coach") {
    throw new HttpError("Coach access required.", 403, "COACH_ACCESS_REQUIRED");
  }
  return user;
}

/**
 * Verifies the Supabase access token against /auth/v1/user and returns the
 * verified email. Throws 401 UNAUTHORIZED on any missing, invalid or
 * expired session.
 */
async function verifySupabaseSession(request: Request, env: Env): Promise<string> {
  const header = request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new HttpError("Missing Authorization header", 401, "UNAUTHORIZED");

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new HttpError("Server authentication not configured", 500);
  }

  const resp = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env.SUPABASE_ANON_KEY,
    },
  });

  if (!resp.ok) {
    const detail = await resp.text();
    console.error("Supabase auth verification failed:", resp.status, detail);
    throw new HttpError("Invalid or expired session", 401, "UNAUTHORIZED");
  }

  const user = (await resp.json()) as { email?: string };
  if (!user.email) throw new HttpError("Session has no associated email", 401, "UNAUTHORIZED");
  return user.email;
}
