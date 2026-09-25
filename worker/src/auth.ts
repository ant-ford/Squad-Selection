import { HttpError } from "./http";
import { normalizeEmail } from "../../shared/normalizeEmail";
import type { Env } from "./env";
import { getOfficerLinks, getPlayerByEmail, getTeamCoachLinks, type Office, type OfficerRole } from "./reference";
import { getCached } from "./cache";

// One definition for the whole app, browser included - see the module for
// why every store in this system disagrees about case.
export { normalizeEmail } from "../../shared/normalizeEmail";

export interface AuthorizedUser {
  /** Verified, normalized email from the Supabase session. */
  email: string;
  /** Matched People record id in Airtable. */
  personId: string;
  /** "coach" when the person holds any coach / section-captain relationship. */
  role: "player" | "coach";
  /**
   * Team names this person coaches (Teams.Coach link). A Section Captain's
   * list is every team name, regardless of Active status - Section Captains
   * see the whole section everywhere, the most permissive existing path.
   */
  coachTeams: string[];
  isSectionCaptain: boolean;
  /**
   * Active Membership Officer, Section Chair and Section Captain rows linked
   * to this person.
   * Empty for almost everyone. Holding any office grants application access
   * on its own, like a coach link: an officer need not be a playing member.
   */
  officerRoles: OfficerRole[];
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
 *  - the Teams table linked Coach / Section Captain fields are the ONLY
 *    source of coach access - computed once, here, for the whole request
 *  - an Active Membership Officer, Section Chair or Section Captain row
 *    linked to the person also grants access with Active = false, and never
 *    grants coach access
 */
export async function requireAuthorizedUser(request: Request, env: Env): Promise<AuthorizedUser> {
  const email = await verifySupabaseSession(request, env);
  const normalizedEmail = normalizeEmail(email);

  // Independent reads keyed off the verified session - run in parallel.
  // No behavioural or security impact: both are pure reads, neither depends
  // on the other's result, and a failure in either rejects the request
  // exactly as the sequential version did. The coach-link lookup warms its
  // 10-minute cache either way.
  // Cached 60s (getPlayerByEmail's default TTL) - the Supabase token
  // verification above still runs on every request, so a revoked session is
  // rejected immediately; only the People-record lookup behind it is cached.
  const [player, links, officers] = await Promise.all([
    getPlayerByEmail(env, normalizedEmail),
    getTeamCoachLinks(env),
    getOfficerLinks(env),
  ]);

  if (!player) {
    console.warn(`Access denied - no People record matched email ${normalizedEmail}`);
    throw new HttpError("Application access is not authorised.", 403, "APPLICATION_ACCESS_DENIED");
  }

  const isActive = player.active === true;

  // Teams table linked fields are the ONLY source of coach access. Uses ALL
  // team records (not just active ones) so a person's access never depends
  // on whether their team record is temporarily marked inactive.
  const isSectionCaptain = links.sectionCaptainIds.includes(player.id);
  // Coach status comes from the Teams.Coach link itself, never from the
  // derived team-name list below. coachTeamNamesByPersonId only gains an
  // entry when the team record has a non-empty Team Name, so deriving access
  // from it silently locked out anyone coaching a team whose name was blank.
  const isTeamCoach = links.coachIds.includes(player.id);
  // Section Captains see every team everywhere - the most permissive of the
  // paths this used to be computed on, now the single definition.
  const coachTeams = isSectionCaptain
    ? links.allTeamNames
    : links.coachTeamNamesByPersonId[player.id] ?? [];
  const isCoach = isTeamCoach || isSectionCaptain;
  const officerRoles = officers.rolesByPersonId[player.id] ?? [];

  if (!isActive && !isCoach && officerRoles.length === 0) {
    // Logged with the matched record id: the commonest cause of a surprise
    // denial is a second People record sharing the email, so the record the
    // administrator is looking at is not the one that was matched.
    console.warn(
      `Access denied - matched People record ${player.id} for ${normalizedEmail} ` +
        `has Active=${JSON.stringify(player.active)}, no coach link and no active office`,
    );
    throw new HttpError("Your HKFC application access has been disabled.", 403, "APPLICATION_ACCESS_DENIED");
  }

  return {
    email: normalizedEmail,
    personId: player.id,
    role: isCoach ? "coach" : "player",
    coachTeams,
    isSectionCaptain,
    officerRoles,
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
 * The officers' sections of the app and the offices that open each one
 * (owner decision, 2026-09-25). Designation plays no part: any Active row in
 * one of the listed tables is enough.
 *
 *   membership - the membership board: Membership Officers, Section Captains
 *   chairman   - the chairman's email lists: Section Chairs, Section Captains
 */
export const SECTION_OFFICES = {
  membership: ["membershipOfficer", "sectionCaptain"],
  chairman: ["sectionChair", "sectionCaptain"],
} as const satisfies Record<string, readonly Office[]>;

export type Section = keyof typeof SECTION_OFFICES;

/** The sections this person can open, in a fixed order. */
export function sectionsFor(user: Pick<AuthorizedUser, "officerRoles">): Section[] {
  return (Object.keys(SECTION_OFFICES) as Section[]).filter((section) =>
    user.officerRoles.some((r) => (SECTION_OFFICES[section] as readonly Office[]).includes(r.office)),
  );
}

/**
 * Gate for one officers' section. 403 OFFICER_ACCESS_REQUIRED otherwise,
 * which, like COACH_ACCESS_REQUIRED, keeps them signed in.
 */
export async function requireSection(request: Request, env: Env, section: Section): Promise<AuthorizedUser> {
  const user = await requireAuthorizedUser(request, env);
  if (!sectionsFor(user).includes(section)) {
    throw new HttpError("Officer access required.", 403, "OFFICER_ACCESS_REQUIRED");
  }
  return user;
}

/**
 * How long a verified token is trusted without re-asking Supabase.
 *
 * Short on purpose. This is the only thing standing between a revoked session
 * and the API, so the window is measured in seconds - long enough to collapse
 * the burst of calls one screen makes, far short of the token's own lifetime.
 */
const SESSION_VERIFY_TTL_MS = 60 * 1000;

/**
 * Verifies the Supabase access token against /auth/v1/user and returns the
 * verified email. Throws 401 UNAUTHORIZED on any missing, invalid or
 * expired session.
 *
 * The verified result is cached briefly. Every authenticated route runs this
 * first, so an uncached check put a blocking round trip to Supabase in front
 * of every single request - and a screen that opens three endpoints at once
 * paid for it three times before any of them started work. Only successes are
 * cached; a rejected token throws before anything is stored.
 */
async function verifySupabaseSession(request: Request, env: Env): Promise<string> {
  const header = request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new HttpError("Missing Authorization header", 401, "UNAUTHORIZED");

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new HttpError("Server authentication not configured", 500);
  }

  // Keyed on the token itself: an exact match is the only way to be certain
  // one session is never answered with another's identity, and the token is
  // already in this isolate's memory alongside the email it maps to.
  const { data } = await getCached<string>(
    `session:${token}`,
    async () => {
      const resp = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: env.SUPABASE_ANON_KEY,
        },
      });

      if (!resp.ok) {
        const detail = await resp.text();
        console.error("Supabase auth verification failed:", resp.status, detail);
        // Only Supabase saying "this token is not valid" is a 401. The app
        // signs a user out on 401, so answering one for a Supabase outage or
        // rate limit (5xx, 429) signed people out for something that was not
        // their session's fault. Those are a 503 the app can simply retry.
        if (resp.status === 401 || resp.status === 403) {
          throw new HttpError("Invalid or expired session", 401, "UNAUTHORIZED");
        }
        throw new HttpError("Sign-in service unavailable, please try again", 503, "AUTH_UNAVAILABLE");
      }

      const user = (await resp.json()) as { email?: string };
      if (!user.email) throw new HttpError("Session has no associated email", 401, "UNAUTHORIZED");
      return user.email;
    },
    SESSION_VERIFY_TTL_MS,
  );
  return data;
}
